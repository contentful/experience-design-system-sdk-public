import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { FinalReviewHost } from '../../../src/import/tui/final-review-host.js';

describe('FinalReviewHost', () => {
  it('renders an error when sessionId is missing', () => {
    const onFinalize = vi.fn();
    const { lastFrame } = render(
      <FinalReviewHost
        extractSessionId={null}
        generatedCount={5}
        autoAccept={false}
        onFinalize={onFinalize}
        onQuit={() => {}}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/no session id|missing/i);
    expect(onFinalize).not.toHaveBeenCalled();
  });

  it('fires onFinalize(generatedCount, 0) on mount when autoAccept is true', async () => {
    const onFinalize = vi.fn();
    render(
      <FinalReviewHost
        extractSessionId="abc-123"
        generatedCount={7}
        autoAccept
        onFinalize={onFinalize}
        onQuit={() => {}}
      />,
    );
    await new Promise((r) => setImmediate(r));
    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize).toHaveBeenCalledWith(7, 0, 0);
  });

  it('does NOT auto-finalize when autoAccept is false', async () => {
    const onFinalize = vi.fn();
    render(
      <FinalReviewHost
        extractSessionId="abc-123"
        generatedCount={7}
        autoAccept={false}
        onFinalize={onFinalize}
        onQuit={() => {}}
      />,
    );
    await new Promise((r) => setImmediate(r));
    expect(onFinalize).not.toHaveBeenCalled();
  });

  it('shows the missing-sessionId error even when autoAccept is true', () => {
    const onFinalize = vi.fn();
    const { lastFrame } = render(
      <FinalReviewHost
        extractSessionId={null}
        generatedCount={5}
        autoAccept
        onFinalize={onFinalize}
        onQuit={() => {}}
      />,
    );
    expect(lastFrame() ?? '').toMatch(/no session id|missing/i);
    expect(onFinalize).not.toHaveBeenCalled();
  });
});
