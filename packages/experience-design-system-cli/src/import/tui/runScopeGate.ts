import { applyScopeDecisions, openPipelineDb } from '../../session/db.js';

export async function runScopeGate(opts: {
  sessionId: string;
  decisions: { accepted: string[]; rejected: string[] };
  onAdvanceToGenerate: (info: { sessionId: string; acceptedCount: number }) => Promise<void> | void;
  onAdvanceToPushFlow: (acceptedCount: number) => Promise<void> | void;
}): Promise<void> {
  const db = openPipelineDb();
  try {
    applyScopeDecisions(db, opts.sessionId, opts.decisions);
  } finally {
    db.close();
  }
  if (opts.decisions.accepted.length > 0) {
    await opts.onAdvanceToGenerate({ sessionId: opts.sessionId, acceptedCount: opts.decisions.accepted.length });
  } else {
    await opts.onAdvanceToPushFlow(0);
  }
}
