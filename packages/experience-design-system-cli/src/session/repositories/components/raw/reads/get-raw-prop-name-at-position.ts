import type { DatabaseSync } from 'node:sqlite';

export function getRawPropNameAtPosition(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  position: number,
): string | null {
  const row = db
    .prepare(`SELECT name FROM raw_props WHERE session_id = ? AND component_id = ? AND position = ?`)
    .get(sessionId, componentId, position);
  return row ? String(row.name) : null;
}
