import type { DatabaseSync } from 'node:sqlite';
import { generateSessionId } from '../session-id.js';
import { getSessionById, type MatchHints } from '../repositories/sessions/read.js';
import { createSession } from '../repositories/sessions/write.js';

export type { MatchHints };

export interface SessionResolution {
  sessionId: string;
  isNew: boolean;
  isResumed: boolean;
}

export function getOrCreateSessionForCommand(
  db: DatabaseSync,
  sessionFlag: string | undefined,
  sessionName: string | undefined,
  _hints: MatchHints,
): SessionResolution {
  const now = new Date().toISOString();

  if (sessionFlag === 'new' || sessionFlag === undefined) {
    const id = generateSessionId();
    createSession(db, id, sessionName ?? null, now);
    return { sessionId: id, isNew: true, isResumed: false };
  }

  if (!getSessionById(db, sessionFlag)) {
    throw new Error(`session '${sessionFlag}' not found.`);
  }
  return { sessionId: sessionFlag, isNew: false, isResumed: false };
}
