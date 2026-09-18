import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../src/session/db.js';
import { replaceRawTokenNamePaths } from '../../../../src/session/services/tokens/replace-raw-token-name-paths.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'replace-raw-token-name-paths-'));
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
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'map tokens' });
  return sessionId;
}

describe('replaceRawTokenNamePaths', () => {
  it('writes name paths with source=automatic by default', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      replaceRawTokenNamePaths(db, sessionId, { 'color-primary': 'color.primary' });

      const rows = db
        .prepare('SELECT raw_name, path, source FROM raw_token_name_paths WHERE session_id = ?')
        .all(sessionId);
      expect(rows).toEqual([{ raw_name: 'color-primary', path: 'color.primary', source: 'automatic' }]);
      db.close();
    });
  });

  it('replaces the automatic set on the second call (delete-then-insert)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      replaceRawTokenNamePaths(db, sessionId, { 'color-primary': 'color.primary' }, 'automatic');
      replaceRawTokenNamePaths(db, sessionId, { 'color-secondary': 'color.secondary' }, 'automatic');

      const rows = db
        .prepare('SELECT raw_name, path FROM raw_token_name_paths WHERE session_id = ? ORDER BY raw_name')
        .all(sessionId);
      expect(rows).toEqual([{ raw_name: 'color-secondary', path: 'color.secondary' }]);
      db.close();
    });
  });

  it('when source=manual, a matching automatic entry for the same raw_name is dropped', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      replaceRawTokenNamePaths(db, sessionId, { 'color-primary': 'color.primary' }, 'automatic');
      replaceRawTokenNamePaths(db, sessionId, { 'color-primary': 'color.brand' }, 'manual');

      const rows = db
        .prepare('SELECT raw_name, path, source FROM raw_token_name_paths WHERE session_id = ? ORDER BY raw_name')
        .all(sessionId);
      expect(rows).toEqual([{ raw_name: 'color-primary', path: 'color.brand', source: 'manual' }]);
      db.close();
    });
  });

  it('bumps session timestamp on write', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const before = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(sessionId) as {
        updated_at: string;
      };

      const wait = new Promise((r) => setTimeout(r, 5));
      return wait.then(() => {
        replaceRawTokenNamePaths(db, sessionId, { 'color-primary': 'color.primary' });
        const after = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(sessionId) as {
          updated_at: string;
        };
        expect(after.updated_at > before.updated_at).toBe(true);
        db.close();
      });
    });
  });
});
