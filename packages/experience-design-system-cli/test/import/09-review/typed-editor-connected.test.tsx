import { render } from 'ink-testing-library';
import { expect, it, vi } from 'vitest';
import { FieldEditor } from '../../../src/tui/import/steps/09-review/components/FieldEditor.js';
import type {
  ImmediateInputHandler,
  ImmediateInputKey,
} from '../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js';

const input = vi.hoisted(() => ({ handler: undefined as ImmediateInputHandler | undefined }));
vi.mock('../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js', async () => {
  const { useRef } = await import('react');
  return {
    useImmediateInput: (handler: ImmediateInputHandler) => {
      const ref = useRef(handler);
      ref.current = handler;
      input.handler = (text, key) => ref.current(text, key);
    },
  };
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
async function press(text: string, key: Partial<ImmediateInputKey> = {}) {
  input.handler!(text, key as ImmediateInputKey);
  await pause();
}

it.each(['success', 'failure', 'invalid', 'duplicate'])(
  'mounted recursive JSON editor preserves acknowledged draft semantics: %s',
  async (mode) => {
    const original = JSON.stringify({
      $type: 'component',
      $properties: {
        rows: {
          $type: 'array',
          $category: 'content',
          $items: {
            $type: 'record',
            $fields: JSON.parse(
              '{"__proto__":{"$type":"boolean","$required":false},"a.b/λ":{"$type":"number","$required":true}}',
            ),
          },
          $default: JSON.parse('[{"__proto__":false,"a.b/λ":0}]'),
        },
      },
    });
    const next = JSON.parse(original);
    next.$description = 'Changed';
    next.$properties.rows.$default[0]['a.b/λ'] = 2;
    const draft =
      mode === 'invalid'
        ? '{broken'
        : mode === 'duplicate'
          ? '{"$type":"component","$properties":{"rows":{},"rows":{}}}'
          : JSON.stringify(next);
    const save = vi.fn(() => mode === 'success');
    const dirty = vi.fn();
    const change = vi.fn();
    const ui = render(
      <FieldEditor
        value={original}
        width={100}
        height={24}
        onSave={save}
        onChange={change}
        onDiscard={vi.fn()}
        onDirtyChange={dirty}
      />,
    );
    try {
      await press('j', { ctrl: true });
      await press('a', { ctrl: true });
      await press(draft);
      await press('s', { ctrl: true });
      if (mode === 'success') {
        expect(save).toHaveBeenCalledWith(draft);
        expect(dirty).toHaveBeenLastCalledWith(false);
        expect(ui.lastFrame()).not.toContain('Component JSON');
      } else {
        expect(ui.lastFrame()).toContain('Component JSON');
        expect(ui.lastFrame()).toContain(
          mode === 'failure' ? 'Save failed' : mode === 'duplicate' ? 'Duplicate JSON object key' : 'JSON',
        );
        expect(change).toHaveBeenLastCalledWith(draft);
        if (mode !== 'failure') expect(save).not.toHaveBeenCalled();
      }
    } finally {
      ui.unmount();
    }
  },
);

it.each(['number', 'array', 'record'])(
  'mounted typed default keeps invalid whole-input spelling and only clears dirty after durable acknowledgement: %s',
  async (type) => {
    const definition =
      type === 'number'
        ? { $type: type, $category: 'content', $default: 0 }
        : type === 'array'
          ? { $type: type, $category: 'content', $items: { $type: 'number' }, $default: [] }
          : {
              $type: type,
              $category: 'content',
              $fields: { count: { $type: 'number', $required: true } },
              $default: { count: 0 },
            };
    const original = JSON.stringify({ $type: 'component', $properties: { value: definition } });
    const save = vi.fn(() => false);
    const validity = vi.fn();
    const dirty = vi.fn();
    const ui = render(
      <FieldEditor
        value={original}
        width={100}
        height={24}
        initialFocusTarget={{ kind: 'prop', name: 'value' }}
        onSave={save}
        onChange={vi.fn()}
        onDiscard={vi.fn()}
        onDraftValidityChange={validity}
        onDirtyChange={dirty}
      />,
    );
    try {
      await press('', { return: true });
      for (let index = 0; index < 3; index++) await press('', { downArrow: true });
      await press('', { return: true });
      await press('x', { ctrl: true });
      await press(type === 'number' ? '1e' : '{');
      await press('s', { ctrl: true });
      expect(save).not.toHaveBeenCalled();
      expect(validity).toHaveBeenLastCalledWith(false);
      expect(ui.lastFrame()).toContain(type === 'number' ? '1e' : '{');
      await press('x', { ctrl: true });
      await press(type === 'number' ? '2' : type === 'array' ? '[0,false]' : '{"count":2}');
      if (type === 'array') {
        await press('s', { ctrl: true });
        expect(save).not.toHaveBeenCalled();
      } else {
        await press('s', { ctrl: true });
        expect(save).toHaveBeenCalled();
        expect(dirty).toHaveBeenLastCalledWith(true);
      }
    } finally {
      ui.unmount();
    }
  },
);

it.each([
  { originalType: 'string', nextType: 'richtext', defaultValue: 'example', retained: true },
  { originalType: 'string', nextType: 'richtext', defaultValue: '', retained: true },
  { originalType: 'richtext', nextType: 'number', defaultValue: 'example', retained: false },
])(
  'mounted type picker preserves compatible defaults and clears incompatible ones: $originalType -> $nextType ($defaultValue)',
  async ({ originalType, nextType, defaultValue, retained }) => {
    const original = JSON.stringify({
      $type: 'component',
      $properties: { value: { $type: originalType, $category: 'content', $default: defaultValue } },
    });
    const change = vi.fn();
    const save = vi.fn(() => true);
    const ui = render(
      <FieldEditor
        value={original}
        width={100}
        height={24}
        initialFocusTarget={{ kind: 'prop', name: 'value' }}
        onSave={save}
        onChange={change}
        onDiscard={vi.fn()}
      />,
    );
    try {
      await press('', { return: true });
      await press('', { downArrow: true });
      await press('', { downArrow: true });
      await press('', { return: true });
      await press('', { rightArrow: true });
      const definition = JSON.parse(change.mock.calls.at(-1)![0]).$properties.value;
      expect(definition.$type).toBe(nextType);
      expect(Object.hasOwn(definition, '$default')).toBe(retained);
      if (retained) expect(definition.$default).toBe(defaultValue);
      await press('s', { ctrl: true });
      expect(save).toHaveBeenCalledOnce();
    } finally {
      ui.unmount();
    }
  },
);
