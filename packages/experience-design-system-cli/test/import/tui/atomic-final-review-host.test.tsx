import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { FinalReviewHost } from '../../../src/import/tui/final-review-host.js';

// The interactive GenerateReview step loads generated components from the
// session DB, which is absent under ink-testing-library — so we assert the
// host mounts the correct step without crashing and does not auto-finalize.
// The full atomic-vs-composite render distinction is covered by the PTY suite.
describe('FinalReviewHost — compositionMode fork', () => {
  it('mounts the atomic step without auto-finalizing', async () => {
    const onFinalize = vi.fn();
    const { lastFrame } = render(
      <FinalReviewHost
        extractSessionId="abc-123"
        generatedCount={3}
        autoAccept={false}
        compositionMode="atomic"
        onFinalize={onFinalize}
        onQuit={() => {}}
      />,
    );
    await new Promise((r) => setImmediate(r));
    // Renders something (not the missing-session error), does not auto-finalize.
    expect(lastFrame() ?? '').not.toMatch(/no session id/i);
    expect(onFinalize).not.toHaveBeenCalled();
  });

  it('mounts the composite step without auto-finalizing', async () => {
    const onFinalize = vi.fn();
    const { lastFrame } = render(
      <FinalReviewHost
        extractSessionId="abc-123"
        generatedCount={3}
        autoAccept={false}
        compositionMode="composite"
        onFinalize={onFinalize}
        onQuit={() => {}}
      />,
    );
    await new Promise((r) => setImmediate(r));
    expect(lastFrame() ?? '').not.toMatch(/no session id/i);
    expect(onFinalize).not.toHaveBeenCalled();
  });

  it('defaults to atomic when compositionMode is omitted (still no auto-finalize)', async () => {
    const onFinalize = vi.fn();
    render(
      <FinalReviewHost
        extractSessionId="abc-123"
        generatedCount={3}
        autoAccept={false}
        onFinalize={onFinalize}
        onQuit={() => {}}
      />,
    );
    await new Promise((r) => setImmediate(r));
    expect(onFinalize).not.toHaveBeenCalled();
  });
});
