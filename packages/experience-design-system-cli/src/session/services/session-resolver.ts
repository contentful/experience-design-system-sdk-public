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

/**
 * Decide which session the caller should operate on:
 *   - `sessionFlag === 'new'` or undefined → create a new session
 *   - explicit id → verify it exists and reuse it (throws if missing)
 *
 * `MatchHints` is accepted for signature stability (callers pass it today) but
 * is not currently used — hint-based session resumption was removed upstream.
 */
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
    throw new Error(`session '${sessionFlag}' not found. Run 'session list' to see active sessions.`);
  }
  return { sessionId: sessionFlag, isNew: false, isResumed: false };
}
