import type { DatabaseSync } from 'node:sqlite';
import type { DTCGTokenEntry, DTCGTokenGroup } from '@contentful/experience-design-system-types';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import { createRawTokenGroups, createRawTokens, deleteRawTokensForSession } from '../../repositories/tokens/write.js';
import { withTransaction } from '../../repositories/shared/with-transaction.js';

export function storeDtcgTokens(
  db: DatabaseSync,
  sessionId: string,
  groups: DTCGTokenGroup[],
  tokens: DTCGTokenEntry[],
): void {
  const now = new Date().toISOString();

  withTransaction(db, () => {
    deleteRawTokensForSession(db, sessionId);
    createRawTokenGroups(db, sessionId, groups);
    createRawTokens(db, sessionId, tokens);
    updateSessionTimestamp(db, sessionId, now);
  });
}
