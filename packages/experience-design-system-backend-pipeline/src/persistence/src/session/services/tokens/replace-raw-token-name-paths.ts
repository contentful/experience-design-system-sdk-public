import type { DatabaseSync } from 'node:sqlite';
import type { RawTokenNamePaths, RawTokenNamePathSource } from '../../repositories/tokens/read.js';
import { updateRawTokenNamePaths } from '../../repositories/tokens/write.js';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import { withTransaction } from '../../repositories/shared/with-transaction.js';

export function replaceRawTokenNamePaths(
  db: DatabaseSync,
  sessionId: string,
  tokenNamePaths: RawTokenNamePaths,
  source: RawTokenNamePathSource = 'automatic',
): void {
  withTransaction(db, () => {
    updateRawTokenNamePaths(db, sessionId, tokenNamePaths, source);
    updateSessionTimestamp(db, sessionId, new Date().toISOString());
  });
}
