/**
 * Decision seam for GenerateReviewStep's mount-time cycle auto-reject
 * (parity plan §3 T2). Extracted so the "strict one-shot per session"
 * invariant can be pinned without simulating the full TUI mount effect.
 *
 * Policy (T2, 2026-07-10):
 * - Fires AT MOST ONCE per session, on the first post-load render where
 *   at least one structural cycle exists.
 * - Once fired, never fires again — regardless of subsequent edits,
 *   cycle emergence, or cycle disappearance.
 * - If the initial cycle set is empty, the effect never fires this
 *   session. A later edit that introduces a cycle updates the sidebar
 *   `(cycle)` badges + push-safety banner + `[F]` gate, but leaves
 *   component statuses alone.
 *
 * The caller pairs this decision with a `useRef<boolean>` that latches
 * after the effect runs. This function itself is memoryless.
 */
export interface AutoRejectDecisionInput {
  loading: boolean;
  autoRejectFired: boolean;
  hasCycle: boolean;
}

export type AutoRejectDecision = 'fire' | 'skip';

export function computeAutoRejectDecision(input: AutoRejectDecisionInput): AutoRejectDecision {
  if (input.loading) return 'skip';
  if (input.autoRejectFired) return 'skip';
  if (!input.hasCycle) return 'skip';
  return 'fire';
}
