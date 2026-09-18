import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../src/session/db.js';
import { replaceRawPropTokenPaths } from '../../../../src/session/services/tokens/replace-raw-prop-token-paths.js';
import { createRawComponent, createRawProps } from '../../../../src/session/repositories/components/raw/write.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'replace-raw-prop-token-paths-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function seedSessionWithComponent(db: ReturnType<typeof openPipelineDb>) {
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'map tokens' });
  const componentId = createRawComponent(
    db,
    sessionId,
    { name: 'Button', source: '/tmp/Button.tsx', framework: 'react', props: [], slots: [] },
    '2026-01-01T00:00:00Z',
  );
  createRawProps(db, sessionId, componentId, [{ name: 'color', type: 'string', required: false }]);
  return { sessionId, componentId };
}

describe('replaceRawPropTokenPaths', () => {
  it('writes each path in position order with the given source', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId, componentId } = seedSessionWithComponent(db);

      replaceRawPropTokenPaths(db, sessionId, componentId, 'color', ['color.primary', 'color.secondary'], 'agent');

      const rows = db
        .prepare(
          'SELECT position, path, source FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ? AND prop_name = ? ORDER BY position',
        )
        .all(sessionId, componentId, 'color');
      expect(rows).toEqual([
        { position: 0, path: 'color.primary', source: 'agent' },
        { position: 1, path: 'color.secondary', source: 'agent' },
      ]);
      db.close();
    });
  });

  it('replaces the entire list on subsequent calls (delete-then-insert)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId, componentId } = seedSessionWithComponent(db);

      replaceRawPropTokenPaths(db, sessionId, componentId, 'color', ['color.primary'], 'agent');
      replaceRawPropTokenPaths(db, sessionId, componentId, 'color', ['color.secondary', 'color.tertiary'], 'review');

      const rows = db
        .prepare(
          'SELECT position, path, source FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ? AND prop_name = ? ORDER BY position',
        )
        .all(sessionId, componentId, 'color');
      expect(rows).toEqual([
        { position: 0, path: 'color.secondary', source: 'review' },
        { position: 1, path: 'color.tertiary', source: 'review' },
      ]);
      db.close();
    });
  });

  it('with an empty list, clears any prior mapping', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId, componentId } = seedSessionWithComponent(db);

      replaceRawPropTokenPaths(db, sessionId, componentId, 'color', ['color.primary'], 'agent');
      replaceRawPropTokenPaths(db, sessionId, componentId, 'color', [], 'review');

      const count = db
        .prepare(
          'SELECT COUNT(*) as c FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ? AND prop_name = ?',
        )
        .get(sessionId, componentId, 'color');
      expect(count).toEqual({ c: 0 });
      db.close();
    });
  });

  it('bumps session timestamp on write', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId, componentId } = seedSessionWithComponent(db);
      const before = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(sessionId) as {
        updated_at: string;
      };

      // Sleep 5ms so the ISO timestamp differs.
      const wait = new Promise((r) => setTimeout(r, 5));
      return wait.then(() => {
        replaceRawPropTokenPaths(db, sessionId, componentId, 'color', ['color.primary'], 'agent');
        const after = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(sessionId) as {
          updated_at: string;
        };
        expect(after.updated_at > before.updated_at).toBe(true);
        db.close();
      });
    });
  });
});
