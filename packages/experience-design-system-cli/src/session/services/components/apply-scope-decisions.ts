import type { DatabaseSync } from 'node:sqlite';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import { updateRawComponentsStatusForNames } from '../../repositories/components/cdf/write.js';

export function applyScopeDecisions(
  db: DatabaseSync,
  sessionId: string,
  decisions: { accepted: string[]; rejected: string[] },
): void {
  const now = new Date().toISOString();
  const acceptedSet = new Set(decisions.accepted);
  const accepted = [...acceptedSet];
  const rejected = [...new Set(decisions.rejected)].filter((n) => !acceptedSet.has(n));

  updateRawComponentsStatusForNames(db, sessionId, rejected, 'rejected');
  updateRawComponentsStatusForNames(db, sessionId, accepted, 'generated');
  updateSessionTimestamp(db, sessionId, now);
}
