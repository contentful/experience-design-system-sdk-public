import { getOrCreateSession, openPipelineDb } from '../../src/index.js';

export function newSession(): string {
  const db = openPipelineDb();
  try {
    return getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
  } finally {
    db.close();
  }
}

export function statuses(sessionId: string): Record<string, string> {
  const db = openPipelineDb();
  try {
    const rows = db.prepare('SELECT name, status FROM raw_components WHERE session_id = ?').all(sessionId) as Array<{
      name: string;
      status: string;
    }>;
    return Object.fromEntries(rows.map((row) => [row.name, row.status]));
  } finally {
    db.close();
  }
}
