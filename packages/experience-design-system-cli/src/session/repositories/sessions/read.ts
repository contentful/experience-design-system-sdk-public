import type { DatabaseSync } from 'node:sqlite';
import type { CommandName } from '../../db.js';

export interface MatchHints {
  command: CommandName;
  inputPath?: string;
  outDir?: string;
}

export function getSessionById(db: DatabaseSync, sessionId: string): { id: string } | null {
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as { id: string } | undefined;
  return row ?? null;
}

export function getLatestCompletedSessionForCommand(db: DatabaseSync, command: CommandName): string | null {
  const row = db
    .prepare(
      `SELECT s.id FROM sessions s
       JOIN steps st ON st.session_id = s.id
       WHERE st.command = ? AND st.status = 'complete'
       ORDER BY st.started_at DESC, st.id DESC
       LIMIT 1`,
    )
    .get(command) as { id: string } | undefined;
  return row?.id ?? null;
}
