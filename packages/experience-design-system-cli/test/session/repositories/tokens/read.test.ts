import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../src/session/db.js';
import { getRawTokenNamePathRows, getRawTokenNamePaths } from '../../../../src/session/repositories/tokens/read.js';
import { updateRawTokenNamePaths } from '../../../../src/session/repositories/tokens/write.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'tokens-read-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function seedSession(db: ReturnType<typeof openPipelineDb>) {
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
  return sessionId;
}

describe('getRawTokenNamePaths', () => {
  it('returns {} for a session with no name paths', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      expect(getRawTokenNamePaths(db, sessionId)).toEqual({});
      db.close();
    });
  });

  it('returns rawName -> path as a plain object', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      updateRawTokenNamePaths(
        db,
        sessionId,
        { 'color-primary': 'color.primary', 'color-secondary': 'color.secondary' },
        'automatic',
      );

      expect(getRawTokenNamePaths(db, sessionId)).toEqual({
        'color-primary': 'color.primary',
        'color-secondary': 'color.secondary',
      });
      db.close();
    });
  });
});

describe('getRawTokenNamePathRows', () => {
  it('returns [] for a session with no name paths', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      expect(getRawTokenNamePathRows(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('preserves the source annotation on each row', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      updateRawTokenNamePaths(db, sessionId, { 'color-primary': 'color.primary' }, 'automatic');
      updateRawTokenNamePaths(db, sessionId, { 'color-secondary': 'color.secondary' }, 'manual');

      const rows = getRawTokenNamePathRows(db, sessionId);
      const bySource = new Map(rows.map((r) => [r.rawName, r.source]));
      expect(bySource.get('color-primary')).toBe('automatic');
      expect(bySource.get('color-secondary')).toBe('manual');
      db.close();
    });
  });

  it('sorts by raw_name', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      updateRawTokenNamePaths(db, sessionId, { 'z-token': 'z', 'a-token': 'a', 'm-token': 'm' }, 'automatic');

      const rows = getRawTokenNamePathRows(db, sessionId);
      expect(rows.map((r) => r.rawName)).toEqual(['a-token', 'm-token', 'z-token']);
      db.close();
    });
  });
});
