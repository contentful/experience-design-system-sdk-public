import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../src/session/db.js';
import { createRawComponent, createRawProps } from '../../../../src/session/repositories/components/raw/write.js';
import { applyCdfRestore } from '../../../../src/session/services/components/apply-cdf-restore.js';
import type { CdfRestorePlan } from '../../../../src/session/core/components/plan-cdf-restore.js';
import type { RawComponentDefinition } from '../../../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-apply-cdf-restore-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dirname(dir), { recursive: true, force: true }).catch(() => {});
  }
});

function seedSession(db: ReturnType<typeof openPipelineDb>) {
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
  return sessionId;
}

function comp(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'Button',
    source: '/tmp/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

describe('applyCdfRestore', () => {
  it('applies byName plan entries by updating cdf columns via updateRawPropCdfByName', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, cid, [{ name: 'variant', type: 'string', required: false }]);

      const plan: CdfRestorePlan = {
        byName: [
          {
            component_id: cid,
            name: 'variant',
            position: 0,
            cdf_type: 'enum',
            cdf_category: 'design',
            cdf_token_kind: null,
          },
        ],
        byPosition: [],
        descriptions: [],
        allowedValues: [],
      };
      applyCdfRestore(db, sessionId, plan);

      const row = db
        .prepare('SELECT cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?')
        .get(sessionId, cid, 'variant');
      expect(row).toEqual({ cdf_type: 'enum', cdf_category: 'design' });
      db.close();
    });
  });

  it('applies byPosition plan entries to props whose cdf_type is NULL (rename-safe restore)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');
      // New extract wrote a differently-named prop at position 0 with no cdf classification.
      createRawProps(db, sessionId, cid, [{ name: 'handleClick', type: '() => void', required: false }]);

      const plan: CdfRestorePlan = {
        byName: [],
        byPosition: [
          {
            component_id: cid,
            name: 'onClick',
            position: 0,
            cdf_type: 'string',
            cdf_category: 'state',
            cdf_token_kind: null,
          },
        ],
        descriptions: [],
        allowedValues: [],
      };
      applyCdfRestore(db, sessionId, plan);

      const row = db
        .prepare(
          'SELECT cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ? AND position = 0',
        )
        .get(sessionId, cid);
      expect(row).toEqual({ cdf_type: 'string', cdf_category: 'state' });
      db.close();
    });
  });

  it('restores descriptions on the matched components', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');

      const plan: CdfRestorePlan = {
        byName: [],
        byPosition: [],
        descriptions: [{ component_id: cid, description: 'A clickable primary action.' }],
        allowedValues: [],
      };
      applyCdfRestore(db, sessionId, plan);

      const row = db.prepare('SELECT description FROM raw_components WHERE component_id = ?').get(cid);
      expect(row).toEqual({ description: 'A clickable primary action.' });
      db.close();
    });
  });

  it('replaces allowed values for a prop wholesale (delete-then-insert per bucket)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, cid, [
        { name: 'variant', type: 'string', required: false, allowedValues: ['old-a', 'old-b'] },
      ]);

      const plan: CdfRestorePlan = {
        byName: [],
        byPosition: [],
        descriptions: [],
        allowedValues: [
          {
            componentId: cid,
            propName: 'variant',
            values: [
              { component_id: cid, prop_name: 'variant', position: 0, value: 'primary' },
              { component_id: cid, prop_name: 'variant', position: 1, value: 'ghost' },
            ],
          },
        ],
      };
      applyCdfRestore(db, sessionId, plan);

      const rows = db
        .prepare(
          'SELECT position, value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ? ORDER BY position',
        )
        .all(sessionId, cid, 'variant');
      expect(rows).toEqual([
        { position: 0, value: 'primary' },
        { position: 1, value: 'ghost' },
      ]);
      db.close();
    });
  });

  it('is a no-op for an empty plan', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      expect(() =>
        applyCdfRestore(db, sessionId, { byName: [], byPosition: [], descriptions: [], allowedValues: [] }),
      ).not.toThrow();
      db.close();
    });
  });
});
