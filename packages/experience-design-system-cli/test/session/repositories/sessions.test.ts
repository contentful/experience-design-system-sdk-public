import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb } from '../../../src/session/db.js';
import {
  getSessionById,
  getLatestCompletedSessionForCommand,
} from '../../../src/session/repositories/sessions/read.js';
import { createSession, updateSessionTimestamp } from '../../../src/session/repositories/sessions/write.js';
import { createPendingStep, updateStepStatus } from '../../../src/session/repositories/steps/write.js';

const tempDirs: string[] = [];

async function withDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sessions-repo-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('sessions repository', () => {
  it('createSession inserts a row that getSessionById can locate', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', 'my-session', now);
      expect(getSessionById(db, 'sess-1')).toEqual({ id: 'sess-1' });
      expect(getSessionById(db, 'nope')).toBeNull();
      db.close();
    });
  });

  it('updateSessionTimestamp updates the updated_at column', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const created = '2020-01-01T00:00:00.000Z';
      const bumped = '2020-06-01T00:00:00.000Z';
      createSession(db, 'sess-1', null, created);
      updateSessionTimestamp(db, 'sess-1', bumped);
      const row = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get('sess-1') as
        | { updated_at: string }
        | undefined;
      expect(row?.updated_at).toBe(bumped);
      db.close();
    });
  });

  it('getLatestCompletedSessionForCommand returns the newest complete step for the command', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const t1 = '2024-01-01T00:00:00.000Z';
      const t2 = '2024-02-01T00:00:00.000Z';
      createSession(db, 'sess-old', null, t1);
      createSession(db, 'sess-new', null, t2);
      const stepOld = createPendingStep(db, 'sess-old', 'analyze extract', {}, t1);
      const stepNew = createPendingStep(db, 'sess-new', 'analyze extract', {}, t2);
      updateStepStatus(db, stepOld, 'complete', {}, null, t1);
      updateStepStatus(db, stepNew, 'complete', {}, null, t2);
      expect(getLatestCompletedSessionForCommand(db, 'analyze extract')).toBe('sess-new');
      db.close();
    });
  });
});
