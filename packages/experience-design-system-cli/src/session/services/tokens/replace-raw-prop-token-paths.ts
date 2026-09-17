import type { DatabaseSync } from 'node:sqlite';
import { updateRawPropTokenPaths, type RawPropTokenPathSource } from '../../repositories/tokens/write.js';
import { withTransaction } from '../../repositories/shared/with-transaction.js';

export function replaceRawPropTokenPaths(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  paths: string[],
  source: RawPropTokenPathSource,
): void {
  withTransaction(db, () => {
    updateRawPropTokenPaths(db, sessionId, componentId, propName, paths, source);
  });
}
