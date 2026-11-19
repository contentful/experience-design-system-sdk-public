import type { DatabaseSync } from 'node:sqlite';

export function rejectGeneratedComponents(db: DatabaseSync, sessionId: string, names: readonly string[]): void {
  if (names.length === 0) return;
  const placeholders = names.map(() => '?').join(',');
  db.prepare(
    `UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ? AND name IN (${placeholders})`,
  ).run(sessionId, ...names);
}
