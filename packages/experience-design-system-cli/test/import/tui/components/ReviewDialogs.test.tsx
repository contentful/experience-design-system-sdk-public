import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ReviewFinalizeDialogs, ReviewReloadDialog } from '../../../../src/import/tui/components/ReviewDialogs.js';

const BASE_PROPS = {
  showFinalize: false,
  showQuit: false,
  accepted: 2,
  rejected: 1,
  needsReview: 0,
  onFinalizeConfirm: vi.fn(),
  onFinalizeCancel: vi.fn(),
  onQuitConfirm: vi.fn(),
  onQuitCancel: vi.fn(),
};

describe('ReviewFinalizeDialogs', () => {
  it('renders the finalize dialog and hides the other overlays', () => {
    const { lastFrame } = render(<ReviewFinalizeDialogs {...BASE_PROPS} showFinalize />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Finalize');
    expect(frame).not.toContain('Quit');
    expect(frame).not.toContain('Reload from saved state?');
  });

  it('renders the quit dialog and hides the other overlays', () => {
    const { lastFrame } = render(<ReviewFinalizeDialogs {...BASE_PROPS} showQuit />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Quit');
    expect(frame).not.toContain('Finalize');
    expect(frame).not.toContain('Reload from saved state?');
  });

  it('renders reload confirmation only when it is open', () => {
    const visible = render(<ReviewReloadDialog open />);
    expect(visible.lastFrame() ?? '').toContain('Reload from saved state?');

    const hidden = render(<ReviewReloadDialog open={false} />);
    expect(hidden.lastFrame() ?? '').not.toContain('Reload from saved state?');
  });
});
