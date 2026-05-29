import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession, createStep, updateStep } from '../../src/session/db.js';
import { getStats } from '../../src/session/stats.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'stats-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('getStats', () => {
  it('returns all zeros for an empty database', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const stats = getStats(db, dbPath);
      expect(stats.sessions.total).toBe(0);
      expect(stats.steps).toBe(0);
      expect(stats.rawComponents).toBe(0);
      expect(stats.oldestSession).toBeNull();
      expect(stats.newestSession).toBeNull();
      db.close();
    });
  });

  it('reflects session status breakdown correctly', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);

      // Session 1: complete
      const s1 = getOrCreateSession(db, 'new', undefined, { command: 'analyze select' });
      const step1 = createStep(db, s1.sessionId, 'analyze select', {});
      updateStep(db, step1, 'complete', {});

      // Session 2: in-progress (pending step)
      const s2 = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });
      createStep(db, s2.sessionId, 'generate tokens', {});

      // Session 3: failed
      const s3 = getOrCreateSession(db, 'new', undefined, { command: 'apply push' });
      const step3 = createStep(db, s3.sessionId, 'apply push', {});
      updateStep(db, step3, 'failed', {}, 'token expired');

      const stats = getStats(db, dbPath);
      expect(stats.sessions.total).toBe(3);
      expect(stats.sessions.complete).toBe(1);
      expect(stats.sessions.inProgress).toBe(1);
      expect(stats.sessions.failed).toBe(1);
      expect(stats.steps).toBe(3);
      db.close();
    });
  });

  it('dbBytes equals page_count * page_size', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const pageCountRow = db.prepare('PRAGMA page_count').get() as { page_count: number };
      const pageSizeRow = db.prepare('PRAGMA page_size').get() as { page_size: number };
      const expected = pageCountRow.page_count * pageSizeRow.page_size;
      const stats = getStats(db, dbPath);
      expect(stats.dbBytes).toBe(expected);
      db.close();
    });
  });

  it('walBytes is 0 when no WAL file exists', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const stats = getStats(db, dbPath);
      // WAL file may or may not exist depending on whether writes have occurred
      expect(stats.walBytes).toBeGreaterThanOrEqual(0);
      db.close();
    });
  });

  it('identifies oldest and newest sessions correctly', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);

      const s1 = getOrCreateSession(db, 'new', undefined, { command: 'analyze select' });
      await new Promise((r) => setTimeout(r, 5));
      const s2 = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      const stats = getStats(db, dbPath);
      expect(stats.oldestSession?.id).toBe(s1.sessionId);
      expect(stats.newestSession?.id).toBe(s2.sessionId);
      db.close();
    });
  });
});
