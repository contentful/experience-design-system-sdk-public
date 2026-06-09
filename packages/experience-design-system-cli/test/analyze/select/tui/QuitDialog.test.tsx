import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { QuitDialog } from '../../../../src/analyze/select/tui/components/QuitDialog.js';

describe('QuitDialog', () => {
  it('shows unsaved draft text when hasUnsavedDrafts is true', () => {
    const { lastFrame } = render(<QuitDialog hasUnsavedDrafts={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(lastFrame()).toContain('unsaved draft');
  });

  it('shows saved state text when hasUnsavedDrafts is false', () => {
    const { lastFrame } = render(<QuitDialog hasUnsavedDrafts={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(lastFrame()).toContain('Session is saved');
  });
});
