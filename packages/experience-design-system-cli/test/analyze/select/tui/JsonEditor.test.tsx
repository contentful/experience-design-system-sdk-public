import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { JsonEditor } from '../../../../src/analyze/select/tui/components/JsonEditor.js';

const INITIAL_VALUE = '{\n  "name": "Button"\n}';

describe('JsonEditor', () => {
  it('renders the initial value', () => {
    const { lastFrame } = render(
      <JsonEditor value={INITIAL_VALUE} width={60} height={10} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(lastFrame()).toContain('"name"');
  });

  it('calls onSave with the current value on Ctrl+S', async () => {
    const onSave = vi.fn();
    const { stdin } = render(
      <JsonEditor value={INITIAL_VALUE} width={60} height={10} onSave={onSave} onDiscard={vi.fn()} />,
    );
    stdin.write('\x13'); // Ctrl+S
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).toHaveBeenCalledWith(INITIAL_VALUE);
  });

  it('shows error and does not call onSave for invalid JSON on Ctrl+S', async () => {
    const onSave = vi.fn();
    const { stdin, lastFrame } = render(
      <JsonEditor value="{ invalid json" width={60} height={10} onSave={onSave} onDiscard={vi.fn()} />,
    );
    stdin.write('\x13'); // Ctrl+S
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Invalid JSON');
  });

  it('calls onDiscard on Esc', async () => {
    const onDiscard = vi.fn();
    const { stdin } = render(
      <JsonEditor value={INITIAL_VALUE} width={60} height={10} onSave={vi.fn()} onDiscard={onDiscard} />,
    );
    stdin.write('\x1b'); // Esc
    await new Promise((r) => setTimeout(r, 30));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('typed characters appear in value passed to onSave', async () => {
    const onSave = vi.fn();
    const { stdin } = render(
      <JsonEditor value={INITIAL_VALUE} width={60} height={10} onSave={onSave} onDiscard={vi.fn()} />,
    );
    stdin.write(' '); // prepend space — still valid JSON
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\x13'); // Ctrl+S
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).toHaveBeenCalled();
  });

  it('inserts newline on Enter (visible in saved value)', async () => {
    const onSave = vi.fn();
    const { stdin } = render(<JsonEditor value='{"a":1}' width={60} height={10} onSave={onSave} onDiscard={vi.fn()} />);
    stdin.write('\r'); // Enter
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\x13'); // Ctrl+S
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0]).toContain('\n');
  });

  it('Ctrl+Z undoes last change', async () => {
    const onSave = vi.fn();
    const { stdin } = render(<JsonEditor value='{"a":1}' width={60} height={10} onSave={onSave} onDiscard={vi.fn()} />);
    stdin.write('x');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\x1a'); // Ctrl+Z
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\x13'); // Ctrl+S
    await new Promise((r) => setTimeout(r, 30));
    expect(onSave).toHaveBeenCalled();
  });

  it('arrow keys and backspace do not crash', async () => {
    const onDiscard = vi.fn();
    const { stdin, lastFrame } = render(
      <JsonEditor value={INITIAL_VALUE} width={60} height={10} onSave={vi.fn()} onDiscard={onDiscard} />,
    );
    stdin.write('\x1b[C'); // right arrow
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\x7f'); // backspace
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame()).toBeTruthy();
    stdin.write('\x1b'); // Esc
    await new Promise((r) => setTimeout(r, 30));
    expect(onDiscard).toHaveBeenCalled();
  });
});
