import type { DatabaseSync } from 'node:sqlite';

export function loadTokenTypeByPath(db: DatabaseSync, sessionId: string): Map<string, string> {
  const rows = db.prepare('SELECT path, type FROM raw_tokens WHERE session_id = ?').all(sessionId) as Array<{
    path: string;
    type: string;
  }>;
  return new Map(rows.map((r) => [r.path, r.type]));
}
