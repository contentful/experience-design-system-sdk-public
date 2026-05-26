import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { QuitDialog } from '../../../../src/analyze/select/tui/components/QuitDialog.js';

describe('QuitDialog', () => {
  it('shows unsaved draft text when hasUnsavedDrafts is true', () => {
    const { lastFrame } = render(<QuitDialog hasUnsavedDrafts={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('unsaved draft');
  });

  it('shows saved state text when hasUnsavedDrafts is false', () => {
    const { lastFrame } = render(<QuitDialog hasUnsavedDrafts={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Session is saved');
  });

  it('calls onConfirm when y is pressed', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(<QuitDialog hasUnsavedDrafts={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 30));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when Esc is pressed', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<QuitDialog hasUnsavedDrafts={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    stdin.write('\x1b');
    await new Promise((r) => setTimeout(r, 30));
    expect(onCancel).toHaveBeenCalled();
  });
});
