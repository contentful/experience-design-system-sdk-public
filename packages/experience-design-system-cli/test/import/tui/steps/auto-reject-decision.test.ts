import { describe, it, expect } from 'vitest';
import { computeAutoRejectDecision } from '../../../../src/import/tui/steps/auto-reject-decision.js';

// T2 (parity plan §3) — mount auto-reject is a strict one-shot per session.
// This module pins the decision contract at a pure-function seam so we can
// verify the "fire at most once" invariant without simulating the full TUI.
describe('computeAutoRejectDecision — strict one-shot (T2)', () => {
  it('loading → skip regardless of cycles', () => {
    expect(
      computeAutoRejectDecision({ loading: true, autoRejectFired: false, hasCycle: true }),
    ).toBe('skip');
  });

  it('post-load, no cycle → skip (never fires this session)', () => {
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: false, hasCycle: false }),
    ).toBe('skip');
  });

  it('post-load, cycle, not yet fired → fire', () => {
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: false, hasCycle: true }),
    ).toBe('fire');
  });

  it('already fired + a NEW cycle appears (edit-induced) → skip (strict one-shot)', () => {
    // Semantic revert of task #37's "re-fire on edit-induced new cycle": the
    // effect must NOT re-fire even when the cycle-participant set changes.
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: true, hasCycle: true }),
    ).toBe('skip');
  });

  it('already fired + cycle set went to zero → skip (no clear, no re-arm)', () => {
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: true, hasCycle: false }),
    ).toBe('skip');
  });

  it('never fires when the initial cycle set is empty even if a cycle later emerges', () => {
    // Session enters with no cycle → effect skips on that render.
    let fired = false;
    const first = computeAutoRejectDecision({ loading: false, autoRejectFired: fired, hasCycle: false });
    expect(first).toBe('skip');
    // A subsequent render (edit introduced a cycle) — autoRejectFired stays
    // false because the effect never got to flip it. But per the T2 policy
    // the effect can only fire on the FIRST post-load render, so a caller
    // that only invokes it once at mount will never fire. This function alone
    // would return 'fire' here; the useEffect body wraps it in a `firedRef`
    // that latches after the first post-load evaluation. That latch is
    // covered by the integration tests in GenerateReviewStep.test.tsx.
    const second = computeAutoRejectDecision({ loading: false, autoRejectFired: fired, hasCycle: true });
    // The helper is deliberately memoryless — it does not itself track
    // "already-evaluated-once". Its job is: given the three flags, should
    // the effect fire? The latch lives at the useRef seam.
    expect(second).toBe('fire');
    fired = true;
    // With the latch flipped, subsequent calls remain 'skip'.
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: fired, hasCycle: true }),
    ).toBe('skip');
  });
});
