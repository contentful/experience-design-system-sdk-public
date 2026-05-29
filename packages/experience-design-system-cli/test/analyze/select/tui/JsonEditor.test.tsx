import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { JsonEditor } from '../../../../src/analyze/select/tui/components/JsonEditor.js';

const INITIAL_VALUE = '{\n  "name": "Button"\n}';

describe('JsonEditor', () => {
  it('renders the initial value', () => {
    const { lastFrame } = render(
      <JsonEditor
        value={INITIAL_VALUE}
        width={60}
        height={10}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('"name"');
  });

  it('calls onSave with valid JSON on Ctrl+S', async () => {
    const onSave = vi.fn();
    const { stdin } = render(
      <JsonEditor
        value={INITIAL_VALUE}
        width={60}
        height={10}
        onChange={vi.fn()}
        onSave={onSave}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('\x13'); // Ctrl+S
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).toHaveBeenCalled();
  });

  it('shows error and does not call onSave for invalid JSON on Ctrl+S', async () => {
    const onSave = vi.fn();
    const { stdin, lastFrame } = render(
      <JsonEditor
        value="{ invalid json"
        width={60}
        height={10}
        onChange={vi.fn()}
        onSave={onSave}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('\x13'); // Ctrl+S
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Invalid JSON');
  });

  it('calls onDiscard on Esc', async () => {
    const onDiscard = vi.fn();
    const { stdin } = render(
      <JsonEditor
        value={INITIAL_VALUE}
        width={60}
        height={10}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={onDiscard}
      />,
    );
    stdin.write('\x1b'); // Esc
    await new Promise((r) => setTimeout(r, 30));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('calls onChange when a character is typed', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <JsonEditor
        value={INITIAL_VALUE}
        width={60}
        height={10}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('x');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalled();
  });

  it('reverts last change on Ctrl+Z', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <JsonEditor
        value={INITIAL_VALUE}
        width={60}
        height={10}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Type a character, then undo it
    stdin.write('x');
    await new Promise((r) => setTimeout(r, 30));
    const callsAfterType = onChange.mock.calls.length;
    expect(callsAfterType).toBeGreaterThan(0);

    stdin.write('\x1a'); // Ctrl+Z
    await new Promise((r) => setTimeout(r, 30));
    // onChange is called again after undo (restores previous state)
    expect(onChange.mock.calls.length).toBeGreaterThan(callsAfterType);
  });

  it('inserts newline on Enter', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <JsonEditor value='{"a":1}' width={60} height={10} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    stdin.write('\r'); // Enter
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalled();
    const lastValue = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastValue).toContain('\n');
  });

  it('deletes character before cursor on Backspace', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <JsonEditor value='{"a":1}' width={60} height={10} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Move right to position cursor after first char, then backspace
    stdin.write('\x1b[C'); // right arrow
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\x7f'); // backspace
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalled();
  });
});
