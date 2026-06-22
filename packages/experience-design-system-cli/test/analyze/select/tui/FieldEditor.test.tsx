import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { FieldEditor } from '../../../../src/analyze/select/tui/components/FieldEditor.js';

const ENUM_COMPONENT = JSON.stringify(
  {
    Button: {
      $type: 'component',
      $description: 'A button',
      $properties: {
        variant: {
          $type: 'enum',
          $category: 'content',
          $description: 'Visual style',
          $values: ['primary', 'secondary', 'tertiary'],
        },
      },
    },
  },
  null,
  2,
);

const STRING_COMPONENT = JSON.stringify(
  {
    Hero: {
      $type: 'component',
      $properties: {
        title: {
          $type: 'string',
          $category: 'content',
          $description: 'Hero title',
        },
      },
    },
  },
  null,
  2,
);

const tick = () => new Promise((r) => setTimeout(r, 30));

/**
 * For an enum prop with description auto-focused, drive the editor into the
 * `values` field. Field order is: type, category, required, values, description.
 * Mount lands on `description` (last). Press Esc → row mode. Press Return →
 * first field (type). Then j×3 to walk: type → category → required → values.
 */
async function navigateToValuesField(stdin: { write: (data: string) => void }): Promise<void> {
  stdin.write('\x1b'); // Esc → row mode
  await tick();
  stdin.write('\r'); // Return → field mode at `type`
  await tick();
  stdin.write('j'); // type → category
  await tick();
  stdin.write('j'); // category → required
  await tick();
  stdin.write('j'); // required → values
  await tick();
}

describe('FieldEditor — auto-focus description (Fix 2)', () => {
  it('mounts with description field auto-active for the first prop', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    // Hint reflects description-active state.
    expect(frame).toMatch(/Type to edit/);
    // The description value is rendered.
    expect(frame).toContain('Hero title');
  });

  it('typed characters extend the description without needing Return first', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('!');
    await tick();
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('Hero title!');
  });

  it('arrow down navigates to the next row from description-active state', async () => {
    const value = JSON.stringify(
      {
        Card: {
          $type: 'component',
          $properties: {
            title: { $type: 'string', $category: 'content', $description: 'first' },
            body: { $type: 'string', $category: 'content', $description: 'second' },
          },
        },
      },
      null,
      2,
    );

    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={value} width={80} height={20} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // After arrow-down, description for `body` is auto-focused — typing edits it.
    stdin.write('\x1b[B');
    await tick();
    stdin.write('Z');
    await tick();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toMatch(/secondZ/);
  });

  it('j/k inside description types literal characters (not row navigation)', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('j');
    await tick();
    stdin.write('k');
    await tick();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('Hero titlejk');
  });
});

describe('FieldEditor — flat enum-values (Fix 3)', () => {
  it('renders the values legend when activeField is values', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[a\]dd/);
    expect(frame).toMatch(/\[e\]dit/);
    expect(frame).toMatch(/\[r\]emove/);
    expect(frame).toMatch(/\[K\/J\] reorder/);
  });

  it('a enters add mode and Enter appends a new value', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    // Add new value
    stdin.write('a');
    await tick();
    stdin.write('q');
    await tick();
    stdin.write('u');
    await tick();
    stdin.write('a');
    await tick();
    stdin.write('d');
    await tick();
    stdin.write('\r'); // Enter to commit
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('quad');
    // Original values still there
    expect(lastCall).toContain('primary');
    expect(lastCall).toContain('secondary');
    expect(lastCall).toContain('tertiary');
  });

  it('e enters edit mode pre-filled at the cursor; Enter replaces the value', async () => {
    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    // Cursor is at index 0 by default (primary). Press 'e' to edit.
    stdin.write('e');
    await tick();
    // Pre-filled with "primary" — visible in frame
    const editFrame = lastFrame() ?? '';
    expect(editFrame).toContain('primary');

    // Backspace through "primary" (7 chars), then type "PRI"
    for (let i = 0; i < 7; i++) {
      stdin.write('\x7f');
      await tick();
    }
    stdin.write('P');
    await tick();
    stdin.write('R');
    await tick();
    stdin.write('I');
    await tick();
    stdin.write('\r');
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('"PRI"');
    expect(lastCall).not.toContain('"primary"');
  });

  it('r removes the value at the cursor', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    stdin.write('r'); // remove at cursor (index 0 = "primary")
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).not.toContain('"primary"');
    expect(lastCall).toContain('"secondary"');
    expect(lastCall).toContain('"tertiary"');
  });

  it('J (capital) moves the value at the cursor down', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    stdin.write('J'); // move cursor (idx 0 = primary) down to idx 1
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    // Expect order in serialized $values: secondary, primary, tertiary
    const sIdx = lastCall.indexOf('"secondary"');
    const pIdx = lastCall.indexOf('"primary"');
    const tIdx = lastCall.indexOf('"tertiary"');
    expect(sIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(tIdx);
  });

  it('Esc cancels add mode without committing', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    stdin.write('a'); // enter add mode
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('\x1b'); // Esc to cancel
    await tick();

    // No change committed — onChange shouldn't have fired with a new value containing "z".
    if (onChange.mock.calls.length > 0) {
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastCall).not.toContain('"z"');
    }
  });
});

describe('FieldEditor — active prop gating', () => {
  it('does not consume keystrokes when active=false', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        active={false}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('Z');
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });
});
