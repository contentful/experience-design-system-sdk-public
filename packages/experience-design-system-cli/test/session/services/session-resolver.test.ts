import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb } from '../../../src/session/db.js';
import { getOrCreateSessionForCommand } from '../../../src/session/services/session-resolver.js';
import { createSession } from '../../../src/session/repositories/sessions/write.js';

const tempDirs: string[] = [];

async function withDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'session-resolver-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('getOrCreateSessionForCommand', () => {
  it('creates a new session when sessionFlag === "new"', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const result = getOrCreateSessionForCommand(db, 'new', 'my-name', { command: 'analyze extract' });
      expect(result.isNew).toBe(true);
      expect(result.isResumed).toBe(false);
      expect(result.sessionId).toMatch(/.+/);
      db.close();
    });
  });

  it('creates a new session when sessionFlag is undefined', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const result = getOrCreateSessionForCommand(db, undefined, undefined, { command: 'analyze extract' });
      expect(result.isNew).toBe(true);
      expect(result.isResumed).toBe(false);
      db.close();
    });
  });

  it('reuses an explicit sessionId that exists', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      createSession(db, 'sess-1', null, new Date().toISOString());
      const result = getOrCreateSessionForCommand(db, 'sess-1', undefined, { command: 'analyze extract' });
      expect(result).toEqual({ sessionId: 'sess-1', isNew: false, isResumed: false });
      db.close();
    });
  });

  it('throws when an explicit sessionId does not exist', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      expect(() => getOrCreateSessionForCommand(db, 'nonexistent', undefined, { command: 'analyze extract' })).toThrow(
        /session 'nonexistent' not found/,
      );
      db.close();
    });
  });
});
