import { writeScopeDecisionsSnapshot } from '../../analyze/select/persistence.js';
import { getDebugLogger } from '../../lib/debug-logger.js';
import { applyScopeDecisions, openPipelineDb } from '../../session/db.js';

export async function runScopeGate(opts: {
  sessionId: string;
  decisions: { accepted: string[]; rejected: string[] };
  onAdvanceToGenerate: (info: { sessionId: string; acceptedCount: number }) => Promise<void> | void;
  onAdvanceToPushFlow: (acceptedCount: number) => Promise<void> | void;
}): Promise<void> {
  const startedAt = Date.now();
  getDebugLogger().event('wizard', 'scope-decision-persistence.start', {
    sessionId: opts.sessionId,
    acceptedCount: opts.decisions.accepted.length,
    rejectedCount: opts.decisions.rejected.length,
  });
  const db = openPipelineDb();
  try {
    applyScopeDecisions(db, opts.sessionId, opts.decisions);
    // Also persist a review-state snapshot so `generate components` can filter
    // out rejected components via loadAcceptedNames. Without this the wizard's
    // scope-gate decisions never reach the generator and rejected components
    // get processed by the LLM anyway.
    await writeScopeDecisionsSnapshot(db, opts.sessionId, opts.decisions);
    getDebugLogger().event('wizard', 'scope-decision-persistence.complete', {
      sessionId: opts.sessionId,
      acceptedCount: opts.decisions.accepted.length,
      rejectedCount: opts.decisions.rejected.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    getDebugLogger().event('wizard', 'scope-decision-persistence.error', {
      sessionId: opts.sessionId,
      acceptedCount: opts.decisions.accepted.length,
      rejectedCount: opts.decisions.rejected.length,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    db.close();
  }
  if (opts.decisions.accepted.length > 0) {
    await opts.onAdvanceToGenerate({ sessionId: opts.sessionId, acceptedCount: opts.decisions.accepted.length });
  } else {
    await opts.onAdvanceToPushFlow(0);
  }
}
