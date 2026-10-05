import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb } from '../../../src/session/db.js';
import { createSession } from '../../../src/session/repositories/sessions/write.js';
import {
  getDtcgTokensForSession,
  getRawTokenNamePaths,
  getRawTokenNamePathRows,
} from '../../../src/session/repositories/tokens/read.js';
import {
  createRawTokenGroups,
  createRawTokens,
  deleteRawTokensForSession,
  updateRawTokenNamePaths,
  updateRawPropTokenPaths,
} from '../../../src/session/repositories/tokens/write.js';

const tempDirs: string[] = [];

async function withDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'tokens-repo-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('tokens repository', () => {
  it('createRawTokenGroups + createRawTokens round-trip through getDtcgTokensForSession', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      createRawTokenGroups(db, 'sess-1', [{ path: 'color.brand', tokenIds: [], $description: 'brand' }]);
      createRawTokens(db, 'sess-1', [
        { path: 'color.brand.primary', $type: 'color', $value: '#f00', $description: 'primary' },
      ]);
      const { groups, tokens } = getDtcgTokensForSession(db, 'sess-1');
      expect(groups[0]?.path).toBe('color.brand');
      expect(groups[0]?.tokenIds).toEqual(['color.brand.primary']);
      expect(tokens[0]?.$value).toBe('#f00');
      db.close();
    });
  });

  it('deleteRawTokensForSession clears both groups and tokens', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      createRawTokenGroups(db, 'sess-1', [{ path: 'color', tokenIds: [] }]);
      createRawTokens(db, 'sess-1', [{ path: 'color.x', $type: 'color', $value: '#0f0' }]);
      deleteRawTokensForSession(db, 'sess-1');
      const { groups, tokens } = getDtcgTokensForSession(db, 'sess-1');
      expect(groups).toEqual([]);
      expect(tokens).toEqual([]);
      db.close();
    });
  });

  it('updateRawTokenNamePaths replaces the automatic set (source=automatic)', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      updateRawTokenNamePaths(db, 'sess-1', { 'brand.primary': 'color.brand.primary' }, 'automatic');
      updateRawTokenNamePaths(db, 'sess-1', { 'brand.secondary': 'color.brand.secondary' }, 'automatic');
      expect(getRawTokenNamePaths(db, 'sess-1')).toEqual({ 'brand.secondary': 'color.brand.secondary' });
      db.close();
    });
  });

  it('updateRawTokenNamePaths with source=manual removes matching automatic entries', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      updateRawTokenNamePaths(db, 'sess-1', { 'brand.primary': 'color.brand.primary' }, 'automatic');
      updateRawTokenNamePaths(db, 'sess-1', { 'brand.primary': 'color.custom.primary' }, 'manual');
      const rows = getRawTokenNamePathRows(db, 'sess-1');
      expect(rows).toEqual([{ rawName: 'brand.primary', path: 'color.custom.primary', source: 'manual' }]);
      db.close();
    });
  });

  it('updateRawPropTokenPaths replaces the list for a given prop', async () => {
    await withDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      createSession(db, 'sess-1', null, now);
      db.prepare(
        `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at)
         VALUES ('sess-1', 'c1', 'Button', 'src/Button.tsx', 'react', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO raw_props (session_id, component_id, name, type, required, position)
         VALUES ('sess-1', 'c1', 'color', 'string', 0, 0)`,
      ).run();
      updateRawPropTokenPaths(db, 'sess-1', 'c1', 'color', ['a.b', 'c.d'], 'agent');
      updateRawPropTokenPaths(db, 'sess-1', 'c1', 'color', ['x.y'], 'review');
      const rows = db
        .prepare(
          `SELECT path, source, position FROM raw_prop_token_paths
           WHERE session_id = 'sess-1' AND component_id = 'c1' AND prop_name = 'color'
           ORDER BY position`,
        )
        .all() as Array<{ path: string; source: string; position: number }>;
      expect(rows).toEqual([{ path: 'x.y', source: 'review', position: 0 }]);
      db.close();
    });
  });
});
