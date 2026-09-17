import type { DatabaseSync } from 'node:sqlite';

export function createSession(db: DatabaseSync, id: string, name: string | null, timestamp: string): void {
  db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    timestamp,
    timestamp,
  );
}

export function touchSession(db: DatabaseSync, sessionId: string, timestamp: string): void {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(timestamp, sessionId);
}
