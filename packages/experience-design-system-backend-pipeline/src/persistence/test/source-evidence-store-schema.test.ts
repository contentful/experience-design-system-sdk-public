import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPipelineDb, getOrCreateSession } from '../src/session/repositories/db.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'source-schema-'));
  directories.push(directory);
  return join(directory, 'pipeline.db');
}
it('installs compact captured-source authority and its currentness fences through normal database opening', () => {
  const db = openPipelineDb(databasePath());
  try {
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_captured_source_roots'").get(),
    ).toBeDefined();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name='session_captured_source_roots_immutable'",
        )
        .get(),
    ).toBeDefined();
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='session_captured_source_step_current'")
        .get(),
    ).toBeDefined();
  } finally {
    db.close();
  }
});
it('upgrades an existing database without removing its session and remains idempotent on reopening', () => {
  const path = databasePath();
  const original = openPipelineDb(path);
  const { sessionId } = getOrCreateSession(original, 'new', undefined, { command: 'analyze extract' });
  original.exec(
    'DROP TABLE IF EXISTS session_captured_source_roots; DROP TRIGGER IF EXISTS session_captured_source_step_current;',
  );
  original.close();
  for (let iteration = 0; iteration < 2; iteration++) {
    const db = openPipelineDb(path);
    try {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_captured_source_roots'").get(),
      ).toBeDefined();
      expect(db.prepare('SELECT id FROM sessions WHERE id=?').get(sessionId)).toEqual({ id: sessionId });
    } finally {
      db.close();
    }
  }
});
