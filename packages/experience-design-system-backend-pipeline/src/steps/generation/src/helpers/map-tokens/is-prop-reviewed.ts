import type { DatabaseSync } from 'node:sqlite';

export function isPropReviewed(db: DatabaseSync, sessionId: string, componentId: string, propName: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM raw_prop_token_paths
        WHERE session_id = ? AND component_id = ? AND prop_name = ?
          AND source = 'review'`,
    )
    .get(sessionId, componentId, propName) as { count: number };
  return row.count > 0;
}
