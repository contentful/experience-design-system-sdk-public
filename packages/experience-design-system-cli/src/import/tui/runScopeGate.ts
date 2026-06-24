import { writeScopeDecisionsSnapshot } from '../../analyze/select/persistence.js';
import { applyScopeDecisions, openPipelineDb } from '../../session/db.js';

export async function runScopeGate(opts: {
  sessionId: string;
  decisions: { accepted: string[]; rejected: string[] };
  /**
   * Optional cancellation hook for the auto-filter (`select-agent`) subprocess.
   * If supplied, it will be awaited BEFORE the review-state snapshot is written
   * so the operator's full decision set is the last writer to the snapshot
   * file. Without this gate the subprocess can race the operator's confirm
   * (see PR #43): if select-agent finishes a batch after the operator presses
   * `f`, it overwrites the snapshot with a partial view and components silently
   * disappear from final-review. Resolves when the subprocess has exited.
   */
  cancelAutoFilter?: () => Promise<void> | void;
  onAdvanceToGenerate: (info: { sessionId: string; acceptedCount: number }) => Promise<void> | void;
  onAdvanceToPushFlow: (acceptedCount: number) => Promise<void> | void;
}): Promise<void> {
  // Cancel-and-await BEFORE any DB / snapshot write. The subprocess's
  // in-flight write may complete before SIGTERM lands; that's fine — we wait
  // for it to fully exit, then our authoritative write goes last.
  if (opts.cancelAutoFilter) {
    await opts.cancelAutoFilter();
  }
  const db = openPipelineDb();
  try {
    applyScopeDecisions(db, opts.sessionId, opts.decisions);
    // Also persist a review-state snapshot so `generate components` can filter
    // out rejected components via loadAcceptedNames. Without this the wizard's
    // scope-gate decisions never reach the generator and rejected components
    // get processed by the LLM anyway.
    await writeScopeDecisionsSnapshot(db, opts.sessionId, opts.decisions);
  } finally {
    db.close();
  }
  if (opts.decisions.accepted.length > 0) {
    await opts.onAdvanceToGenerate({ sessionId: opts.sessionId, acceptedCount: opts.decisions.accepted.length });
  } else {
    await opts.onAdvanceToPushFlow(0);
  }
}
