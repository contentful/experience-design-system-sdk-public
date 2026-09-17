import type { DatabaseSync } from 'node:sqlite';

export function findStepSessionId(db: DatabaseSync, stepId: number): string | null {
  const row = db.prepare('SELECT session_id FROM steps WHERE id = ?').get(stepId) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}
