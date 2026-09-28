import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { FinalReviewHost } from '../../../src/import/tui/final-review-host.js';

describe('FinalReviewHost', () => {
  it('renders an error when sessionId is missing', () => {
    const onFinalize = vi.fn();
    const { lastFrame } = render(<FinalReviewHost extractSessionId={null} onFinalize={onFinalize} onQuit={() => {}} />);
    const out = lastFrame() ?? '';
    expect(out).toMatch(/no session id|missing/i);
    expect(onFinalize).not.toHaveBeenCalled();
  });
});
