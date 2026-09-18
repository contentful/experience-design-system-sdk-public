import type { DatabaseSync } from 'node:sqlite';

export function hasRawPropNamed(db: DatabaseSync, sessionId: string, componentId: string, propName: string): boolean {
  const row = db
    .prepare('SELECT 1 as one FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?')
    .get(sessionId, componentId, propName);
  return row !== undefined;
}
