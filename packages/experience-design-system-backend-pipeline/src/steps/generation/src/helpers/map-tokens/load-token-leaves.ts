import type { DatabaseSync } from 'node:sqlite';

export function loadTokenLeaves(db: DatabaseSync, sessionId: string): Array<{ path: string; type: string }> {
  return db.prepare('SELECT path, type FROM raw_tokens WHERE session_id = ? ORDER BY path').all(sessionId) as Array<{
    path: string;
    type: string;
  }>;
}
