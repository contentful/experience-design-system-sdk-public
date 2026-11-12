import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldEditor } from '../../../src/tui/import/steps/09-review/components/FieldEditor.js';

const value = JSON.stringify({
  $type: 'component',
  $properties: {
    title: { $type: 'string', $category: 'content', $description: 'Property description', $default: 'Hello' },
  },
  $slots: {
    children: { $description: 'Slot description', $allowedComponents: ['Button'] },
  },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

afterEach(cleanup);

describe('FieldEditor', () => {
  it('renders the selected slot and keeps every slot field visibly focused', async () => {
    const onChange = vi.fn();
    const view = render(
      <FieldEditor
        value={value}
        width={80}
        height={18}
        fixedHeight
        initialFocusTarget={{ kind: 'slot', name: 'children' }}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = () => stripAnsi(view.lastFrame() ?? '');
    const press = async (key: string) => {
      view.stdin.write(key);
      await settle();
    };

    await settle();
    await press('\r');
    expect(frame()).toContain('Slot description');
    expect(frame()).toContain('› desc:');
    expect(frame()).not.toContain('Property description');
    expect(frame()).not.toContain('type:');
    expect(frame()).not.toContain('default:');

    await press('\x1b[B');
    expect(frame()).toContain('› req:');
    await press('\x1b[B');
    expect(frame()).toContain('› allowed:');
    expect(frame()).toContain('Button');

    await press('\r');
    await press('r');
    const updated = JSON.parse(onChange.mock.lastCall![0]);
    expect(updated.$slots.children.$allowedComponents).toBeUndefined();
    expect(updated.$properties.title).toEqual(JSON.parse(value).$properties.title);

    await press('\r');
    await press('\x1b[B');
    expect(frame()).toContain('Slot description');
    expect(frame()).toContain('› desc:');
    await press('\x1b[B');
    expect(frame()).toContain('› req:');
  });

  it('keeps type and default accessible when editing a property', async () => {
    const view = render(
      <FieldEditor
        value={value}
        width={80}
        height={18}
        fixedHeight
        initialFocusTarget={{ kind: 'prop', name: 'title' }}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const press = async (key: string) => {
      view.stdin.write(key);
      await settle();
    };

    await settle();
    await press('\r');
    await press('\x1b[B');
    await press('\x1b[B');
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('› type:');
    await press('\x1b[B');
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('› default:');
    expect(stripAnsi(view.lastFrame() ?? '')).not.toContain('Slot description');
  });
});
