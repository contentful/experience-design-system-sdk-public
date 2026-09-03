import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  updateStep,
  storeRawComponents,
  loadRawComponents,
  storeCDFComponents,
  loadCDFComponents,
  storeDTCGTokens,
  loadDTCGTokens,
  findLatestSessionForCommand,
  seedCDFFromPriorSession,
  seedCDFFromPreviewResponse,
  applyToolCalls,
  backfillUnclassifiedProps,
  computeComponentInputHash,
  computeTokenInputHash,
  lookupCache,
  lookupCacheByEntity,
  storeCache,
  markCacheHumanEdited,
  copyComponentFromCache,
  copyTokensFromCache,
  renameEmptySlots,
  loadScopeComponents,
  replaceRawPropTokenPaths,
  loadRawPropTokenPaths,
  computeMapTokensInputHash,
  countMappableTokenProps,
  countRawTokens,
  loadComponentSourceRefs,
  loadComponentSourceRef,
  copyMapTokensFromCache,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';
import type {
  CDFComponentEntry,
  DTCGTokenEntry,
  DTCGTokenGroup,
  ComponentTypeSummary,
} from '@contentful/experience-design-system-types';
import { CDF_V1_SCHEMA_URL, validateCDF } from '@contentful/experience-design-system-types';
import { rebuildDTCGTree } from '../../src/print/command.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-db-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  await run(dbPath);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('openPipelineDb', () => {
  it('creates pipeline.db at the specified path and schema tables exist', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{
        name: string;
      }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('sessions');
      expect(names).toContain('steps');
      expect(names).toContain('raw_components');
      expect(names).not.toContain('refine_components');
      expect(names).not.toContain('refine_events');
      expect(names).not.toContain('import_items');
      expect(names).toContain('migrations');
      expect(names).toContain('raw_tokens');
      expect(names).toContain('raw_token_groups');
      db.close();
    });
  });

  it('is idempotent: opening the same DB twice does not error', async () => {
    await withTempDb((dbPath) => {
      const db1 = openPipelineDb(dbPath);
      db1.close();
      const db2 = openPipelineDb(dbPath);
      db2.close();
    });
  });

  it('enables WAL journal mode on every open', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(row.journal_mode.toLowerCase()).toBe('wal');
      db.close();
    });
  });

  it('sets a non-zero busy_timeout on every open', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
      expect(row.timeout).toBeGreaterThan(0);
      db.close();
    });
  });

  it('allows two concurrent handles against the same DB to write without raising "database is locked"', async () => {
    await withTempDb((dbPath) => {
      const db1 = openPipelineDb(dbPath);
      const db2 = openPipelineDb(dbPath);
      const now = new Date().toISOString();
      db1
        .prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('s1', null, now, now);
      db2
        .prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('s2', null, now, now);
      db1.close();
      db2.close();
    });
  });

  it('adds rationale and source-location columns to raw_props (Feature 1)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const cols = db.prepare('PRAGMA table_info(raw_props)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.has('rationale')).toBe(true);
      expect(byName.has('source_start_line')).toBe(true);
      expect(byName.has('source_end_line')).toBe(true);
      expect(byName.get('rationale')!.notnull).toBe(0);
      expect(byName.get('source_start_line')!.notnull).toBe(0);
      expect(byName.get('source_end_line')!.notnull).toBe(0);
      db.close();
    });
  });

  it('adds source_path column to raw_components (Feature 1)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const cols = db.prepare('PRAGMA table_info(raw_components)').all() as Array<{
        name: string;
        notnull: number;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.has('source_path')).toBe(true);
      expect(byName.get('source_path')!.notnull).toBe(0);
      db.close();
    });
  });

  it('Feature 1 migrations are idempotent across opens', async () => {
    await withTempDb((dbPath) => {
      const db1 = openPipelineDb(dbPath);
      db1.close();
      const db2 = openPipelineDb(dbPath);
      const propCols = db2.prepare('PRAGMA table_info(raw_props)').all() as Array<{ name: string }>;
      const propNames = propCols.map((c) => c.name);
      expect(propNames.filter((n) => n === 'rationale').length).toBe(1);
      expect(propNames.filter((n) => n === 'source_start_line').length).toBe(1);
      expect(propNames.filter((n) => n === 'source_end_line').length).toBe(1);
      const compCols = db2.prepare('PRAGMA table_info(raw_components)').all() as Array<{ name: string }>;
      expect(compCols.map((c) => c.name).filter((n) => n === 'source_path').length).toBe(1);
      db2.close();
    });
  });

  it('adds reject_reason column to raw_components (Feature 3)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const cols = db.prepare('PRAGMA table_info(raw_components)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.has('reject_reason')).toBe(true);
      expect(byName.get('reject_reason')!.type).toBe('TEXT');
      expect(byName.get('reject_reason')!.notnull).toBe(0);
      db.close();
    });
  });

  it('Feature 3 reject_reason migration is idempotent across opens', async () => {
    await withTempDb((dbPath) => {
      const db1 = openPipelineDb(dbPath);
      db1.close();
      const db2 = openPipelineDb(dbPath);
      const compCols = db2.prepare('PRAGMA table_info(raw_components)').all() as Array<{ name: string }>;
      expect(compCols.map((c) => c.name).filter((n) => n === 'reject_reason').length).toBe(1);
      db2.close();
    });
  });

  it('preserves existing rows with reject_reason = NULL after migration', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      db.prepare(
        `INSERT INTO sessions (id, created_at, updated_at)
         VALUES ('s1', '2026-06-23T00:00:00Z', '2026-06-23T00:00:00Z')`,
      ).run();
      db.prepare(
        `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at)
         VALUES ('s1', 'c1', 'Foo', 'src/Foo.tsx', 'react', '2026-06-23T00:00:00Z')`,
      ).run();
      db.close();
      const db2 = openPipelineDb(dbPath);
      const row = db2
        .prepare('SELECT reject_reason FROM raw_components WHERE session_id = ? AND component_id = ?')
        .get('s1', 'c1') as { reject_reason: string | null };
      expect(row.reject_reason).toBeNull();
      db2.close();
    });
  });

  it('backfills raw_prop_token_paths.source as agent on a database that predates the column', async () => {
    await withTempDb((dbPath) => {
      const initial = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(initial, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(initial, sessionId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'bgColor', type: 'string', required: false, category: 'design' }],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(initial, sessionId)[0].component_id;

      // Simulate the pre-provenance shape and leave a row behind in it.
      initial.exec('ALTER TABLE raw_prop_token_paths DROP COLUMN source');
      initial
        .prepare(
          `INSERT INTO raw_prop_token_paths (session_id, component_id, prop_name, kind, position, path)
           VALUES (?, ?, 'bgColor', 'allowed', 0, 'colors.surface.default')`,
        )
        .run(sessionId, componentId);
      initial.close();

      const migrated = openPipelineDb(dbPath);
      const cols = migrated.prepare('PRAGMA table_info(raw_prop_token_paths)').all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name)).toContain('source');
      // A row written before the review editor could set its own list can only
      // have come from map tokens, so 'agent' is the correct backfill.
      expect(migrated.prepare(`SELECT source FROM raw_prop_token_paths WHERE prop_name = 'bgColor'`).get()).toEqual({
        source: 'agent',
      });
      migrated.close();
    });
  });

  it('migrates legacy databases with no raw_prop_token_paths table exactly once', async () => {
    await withTempDb((dbPath) => {
      const initial = openPipelineDb(dbPath);
      initial.exec('DROP TABLE raw_prop_token_paths');
      initial.prepare('DELETE FROM migrations WHERE name = ?').run('001-raw-prop-token-paths');
      initial.close();

      const migrated = openPipelineDb(dbPath);
      const tables = migrated
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raw_prop_token_paths'`)
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
      expect(
        migrated.prepare('SELECT COUNT(*) AS count FROM migrations WHERE name = ?').get('001-raw-prop-token-paths'),
      ).toEqual({ count: 1 });
      migrated.close();

      const reopened = openPipelineDb(dbPath);
      expect(
        reopened.prepare('SELECT COUNT(*) AS count FROM migrations WHERE name = ?').get('001-raw-prop-token-paths'),
      ).toEqual({ count: 1 });
      reopened.close();
    });
  });
});

describe('raw prop token paths', () => {
  it('replaces paths per prop and kind, then loads ordered groups', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Button',
          source: 'src/Button.tsx',
          framework: 'react',
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      replaceRawPropTokenPaths(
        db,
        sessionId,
        componentId,
        'variant',
        'set',
        ['color.brand.primary', 'color.brand.secondary'],
        'agent',
      );
      replaceRawPropTokenPaths(db, sessionId, componentId, 'variant', 'allowed', ['color.text.default'], 'agent');
      replaceRawPropTokenPaths(db, sessionId, componentId, 'variant', 'set', ['color.brand.tertiary'], 'agent');
      replaceRawPropTokenPaths(db, sessionId, componentId, 'variant', 'allowed', [], 'agent');

      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        {
          componentId,
          propName: 'variant',
          kind: 'set',
          paths: ['color.brand.tertiary'],
        },
      ]);
      expect(
        db
          .prepare(
            `SELECT position, path FROM raw_prop_token_paths
             WHERE session_id = ? AND component_id = ? AND prop_name = ? AND kind = ?
             ORDER BY position`,
          )
          .all(sessionId, componentId, 'variant', 'allowed'),
      ).toEqual([]);
      db.close();
    });
  });
});

describe('applyToolCalls clears the other property type on reclassification', () => {
  it('clears raw_prop_token_paths when a prop moves from token to enum', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Badge',
          source: 'src/Badge.tsx',
          framework: 'react',
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [{ tool: 'classify_prop', prop: 'variant', cdf_type: 'token', cdf_category: 'design', token_kind: 'color' }],
        [],
      );
      replaceRawPropTokenPaths(db, sessionId, componentId, 'variant', 'allowed', ['color.blue.500'], 'agent');

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [
          {
            tool: 'classify_prop',
            prop: 'variant',
            cdf_type: 'enum',
            cdf_category: 'design',
            values: ['primary', 'secondary'],
          },
        ],
        [],
      );

      expect(loadRawPropTokenPaths(db, sessionId).filter((g) => g.componentId === componentId)).toEqual([]);
      db.close();
    });
  });

  it('drops values supplied on a token classify_prop call and warns', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Badge',
          source: 'src/Badge.tsx',
          framework: 'react',
          props: [{ name: 'bgColor', type: 'string', required: false }],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      const result = applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [
          {
            tool: 'classify_prop',
            prop: 'bgColor',
            cdf_type: 'token',
            cdf_category: 'design',
            token_kind: 'color',
            values: ['primary', 'secondary'],
          },
        ],
        [],
      );

      // The classification stands — only the vocabulary is refused.
      expect(result.classified).toBe(1);
      expect(result.warnings.join('\n')).toContain('dropped 2 values on a token property');
      const stored = db
        .prepare(`SELECT value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ?`)
        .all(sessionId, componentId);
      expect(stored).toEqual([]);
      db.close();
    });
  });

  it('still stores values for a non-token classify_prop call', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Badge',
          source: 'src/Badge.tsx',
          framework: 'react',
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      const result = applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [
          {
            tool: 'classify_prop',
            prop: 'variant',
            cdf_type: 'enum',
            cdf_category: 'design',
            values: ['primary', 'secondary'],
          },
        ],
        [],
      );

      expect(result.warnings).toEqual([]);
      const stored = db
        .prepare(
          `SELECT value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? ORDER BY position`,
        )
        .all(sessionId, componentId) as Array<{ value: string }>;
      expect(stored.map((r) => r.value)).toEqual(['primary', 'secondary']);
      db.close();
    });
  });

  it('clears raw_prop_allowed_values when a prop moves from enum to token', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Badge',
          source: 'src/Badge.tsx',
          framework: 'react',
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [
          {
            tool: 'classify_prop',
            prop: 'variant',
            cdf_type: 'enum',
            cdf_category: 'design',
            values: ['primary', 'secondary'],
          },
        ],
        [],
      );

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [{ tool: 'classify_prop', prop: 'variant', cdf_type: 'token', cdf_category: 'design', token_kind: 'color' }],
        [],
      );

      const [{ entry }] = loadCDFComponents(db, sessionId);
      expect(entry.$properties.variant.$values).toBeUndefined();
      const remaining = db
        .prepare('SELECT COUNT(*) AS count FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ?')
        .get(sessionId, componentId) as { count: number };
      expect(remaining.count).toBe(0);
      db.close();
    });
  });

  it('does not disturb existing token paths when a prop is reclassified but stays token', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Badge',
          source: 'src/Badge.tsx',
          framework: 'react',
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [{ tool: 'classify_prop', prop: 'variant', cdf_type: 'token', cdf_category: 'design', token_kind: 'color' }],
        [],
      );
      replaceRawPropTokenPaths(db, sessionId, componentId, 'variant', 'allowed', ['color.blue.500'], 'agent');

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Badge',
        [
          {
            tool: 'classify_prop',
            prop: 'variant',
            cdf_type: 'token',
            cdf_category: 'design',
            token_kind: 'color',
            description: 'updated description',
          },
        ],
        [],
      );

      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'variant', kind: 'allowed', paths: ['color.blue.500'] },
      ]);
      db.close();
    });
  });
});

describe('loadScopeComponents (Feature 3)', () => {
  it('returns components with aiDecision/aiReason derived from status + reject_reason', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const baseComp = (overrides: Partial<RawComponentDefinition>): RawComponentDefinition => ({
        name: 'X',
        source: 'src/X.tsx',
        framework: 'react',
        props: [],
        slots: [],
        ...overrides,
      });
      storeRawComponents(db, sessionId, [
        baseComp({ name: 'Accepted', source: 'src/Accepted.tsx' }),
        baseComp({ name: 'Rejected', source: 'src/Rejected.tsx' }),
        baseComp({ name: 'Untouched', source: 'src/Untouched.tsx' }),
      ]);
      db.prepare(
        `UPDATE raw_components SET status = 'accepted', reject_reason = NULL WHERE session_id = ? AND name = 'Accepted'`,
      ).run(sessionId);
      db.prepare(
        `UPDATE raw_components SET status = 'rejected', reject_reason = 'low semantic value' WHERE session_id = ? AND name = 'Rejected'`,
      ).run(sessionId);

      const loaded = loadScopeComponents(db, sessionId);
      db.close();

      expect(loaded).toHaveLength(3);
      const byName = new Map(loaded.map((c) => [c.name, c]));
      expect(byName.get('Accepted')?.aiDecision).toBe('accepted');
      expect(byName.get('Accepted')?.aiReason).toBeNull();
      expect(byName.get('Rejected')?.aiDecision).toBe('rejected');
      expect(byName.get('Rejected')?.aiReason).toBe('low semantic value');
      expect(byName.get('Untouched')?.aiDecision).toBeNull();
      expect(byName.get('Untouched')?.aiReason).toBeNull();
    });
  });
});

describe('getOrCreateSession', () => {
  it('with "new": always creates a new row', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const r1 = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze select',
      });
      const r2 = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze select',
      });
      expect(r1.isNew).toBe(true);
      expect(r2.isNew).toBe(true);
      expect(r1.sessionId).not.toBe(r2.sessionId);
      db.close();
    });
  });

  it('with existing id: returns that session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const created = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze select',
      });
      const attached = getOrCreateSession(db, created.sessionId, undefined, {
        command: 'analyze select',
      });
      expect(attached.sessionId).toBe(created.sessionId);
      expect(attached.isNew).toBe(false);
      db.close();
    });
  });

  it('with unknown id: throws an error', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      expect(() =>
        getOrCreateSession(db, 'no-such-id', undefined, {
          command: 'analyze select',
        }),
      ).toThrow("session 'no-such-id' not found");
      db.close();
    });
  });

  it('with no flag and no match: creates new session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const r = getOrCreateSession(db, undefined, undefined, {
        command: 'analyze select',
      });
      expect(r.isNew).toBe(true);
      db.close();
    });
  });

  it('with no flag and matching pending step: still creates a fresh session (no implicit resume)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const created = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze select',
      });
      const inputPath = '/tmp/raw-components.json';
      createStep(db, created.sessionId, 'analyze select', {
        rawComponents: inputPath,
      });

      const next = getOrCreateSession(db, undefined, undefined, {
        command: 'analyze select',
        inputPath,
      });
      expect(next.sessionId).not.toBe(created.sessionId);
      expect(next.isNew).toBe(true);
      expect(next.isResumed).toBe(false);
      db.close();
    });
  });

  it('with no flag: two successive calls create two distinct sessions', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const hints = {
        command: 'analyze extract' as const,
        inputPath: '/tmp/project',
        outDir: '/tmp/out',
      };
      const r1 = getOrCreateSession(db, undefined, undefined, hints);
      const r2 = getOrCreateSession(db, undefined, undefined, hints);
      expect(r1.isNew).toBe(true);
      expect(r2.isNew).toBe(true);
      expect(r1.isResumed).toBe(false);
      expect(r2.isResumed).toBe(false);
      expect(r1.sessionId).not.toBe(r2.sessionId);
      db.close();
    });
  });
});

describe('createStep + updateStep', () => {
  it('step starts as pending and transitions to complete', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze select',
      });
      const stepId = createStep(db, sessionId, 'analyze select', {
        rawComponents: '/tmp/raw.json',
      });

      const pending = db.prepare('SELECT status FROM steps WHERE id = ?').get(stepId) as { status: string };
      expect(pending.status).toBe('pending');

      updateStep(db, stepId, 'complete', {
        refinedComponents: '/tmp/refined.json',
      });

      const done = db.prepare('SELECT status, completed_at FROM steps WHERE id = ?').get(stepId) as {
        status: string;
        completed_at: string | null;
      };
      expect(done.status).toBe('complete');
      expect(done.completed_at).not.toBeNull();
      db.close();
    });
  });

  it('marks prior pending step as interrupted when a new step is created for the same command', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze select',
      });
      const firstStepId = createStep(db, sessionId, 'analyze select', {});

      const secondStepId = createStep(db, sessionId, 'analyze select', {});

      const first = db.prepare('SELECT status FROM steps WHERE id = ?').get(firstStepId) as { status: string };
      expect(first.status).toBe('interrupted');

      const second = db.prepare('SELECT status FROM steps WHERE id = ?').get(secondStepId) as { status: string };
      expect(second.status).toBe('pending');
      db.close();
    });
  });
});

describe('storeRawComponents + loadRawComponents', () => {
  const COMPONENTS: RawComponentDefinition[] = [
    {
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react',
      props: [],
      slots: [],
    },
    {
      name: 'Input',
      source: 'src/Input.tsx',
      framework: 'react',
      props: [{ name: 'value', type: 'string', required: false }],
      slots: [],
    },
  ];

  it('stores and loads raw components round-trip', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      storeRawComponents(db, sessionId, COMPONENTS);

      const loaded = loadRawComponents(db, sessionId);
      expect(loaded).toHaveLength(2);
      expect(loaded[0]?.name).toBe('Button');
      expect(loaded[1]?.name).toBe('Input');
      expect(loaded[1]?.props).toHaveLength(1);
      db.close();
    });
  });

  it('is idempotent: re-storing replaces existing rows', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      storeRawComponents(db, sessionId, COMPONENTS);
      storeRawComponents(db, sessionId, [COMPONENTS[0]!]);

      const loaded = loadRawComponents(db, sessionId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.name).toBe('Button');
      db.close();
    });
  });

  it('returns empty array for a session with no raw components', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const loaded = loadRawComponents(db, sessionId);
      expect(loaded).toHaveLength(0);
      db.close();
    });
  });

  it('schema table exists after openPipelineDb', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{
        name: string;
      }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('raw_components');
      db.close();
    });
  });

  it('round-trips sourcePath and per-prop source location (Feature 1)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const components: RawComponentDefinition[] = [
        {
          name: 'Button',
          source: 'export interface ButtonProps { label: string }',
          framework: 'react',
          sourcePath: '/proj/Button.tsx',
          props: [
            {
              name: 'label',
              type: 'string',
              required: true,
              sourceStartLine: 12,
              sourceEndLine: 15,
            },
          ],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, components);

      const propRow = db
        .prepare(
          `SELECT rationale, source_start_line, source_end_line FROM raw_props WHERE session_id = ? AND name = ?`,
        )
        .get(sessionId, 'label') as { rationale: string | null; source_start_line: number; source_end_line: number };
      expect(propRow.source_start_line).toBe(12);
      expect(propRow.source_end_line).toBe(15);
      expect(propRow.rationale).toBeNull();

      const compRow = db.prepare(`SELECT source_path FROM raw_components WHERE session_id = ?`).get(sessionId) as {
        source_path: string | null;
      };
      expect(compRow.source_path).toBe('/proj/Button.tsx');
      db.close();
    });
  });

  it('stores NULL when sourcePath/source lines are undefined (Feature 1)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const components: RawComponentDefinition[] = [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'title', type: 'string', required: false }],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, components);

      const propRow = db
        .prepare(`SELECT source_start_line, source_end_line FROM raw_props WHERE session_id = ?`)
        .get(sessionId) as { source_start_line: number | null; source_end_line: number | null };
      expect(propRow.source_start_line).toBeNull();
      expect(propRow.source_end_line).toBeNull();

      const compRow = db.prepare(`SELECT source_path FROM raw_components WHERE session_id = ?`).get(sessionId) as {
        source_path: string | null;
      };
      expect(compRow.source_path).toBeNull();
      db.close();
    });
  });

  it('loadComponentReviewMetadata returns rationale and source location (Feature 1)', async () => {
    const { loadComponentReviewMetadata, applyToolCalls } = await import('../../src/session/db.js');
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const components: RawComponentDefinition[] = [
        {
          name: 'Hero',
          source: 'L1\nL2\nL3\nL4',
          framework: 'react',
          props: [{ name: 'title', type: 'string', required: true, sourceStartLine: 2, sourceEndLine: 3 }],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, components);
      const compId = (
        db
          .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?`)
          .get(sessionId, 'Hero') as { component_id: string }
      ).component_id;

      applyToolCalls(
        db,
        sessionId,
        compId,
        'Hero',
        [
          {
            tool: 'classify_prop',
            prop: 'title',
            cdf_type: 'string',
            cdf_category: 'content',
            reason: 'inferred from PropertySignature',
          },
        ],
        [],
      );

      const meta = loadComponentReviewMetadata(db, sessionId, 'Hero');
      expect(meta).not.toBeNull();
      expect(meta!.componentSource).toBe('L1\nL2\nL3\nL4');
      expect(meta!.sourcePath).toBeNull();
      expect(meta!.props.title?.rationale).toBe('inferred from PropertySignature');
      expect(meta!.props.title?.sourceStartLine).toBe(2);
      expect(meta!.props.title?.sourceEndLine).toBe(3);
      db.close();
    });
  });

  it('adds component-level rationale columns to raw_components (component-rationale)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const cols = db.prepare('PRAGMA table_info(raw_components)').all() as Array<{
        name: string;
        notnull: number;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.has('component_description_rationale')).toBe(true);
      expect(byName.has('props_rationale')).toBe(true);
      expect(byName.has('slots_rationale')).toBe(true);
      expect(byName.get('component_description_rationale')!.notnull).toBe(0);
      expect(byName.get('props_rationale')!.notnull).toBe(0);
      expect(byName.get('slots_rationale')!.notnull).toBe(0);
      db.close();
    });
  });

  it('adds rationale column to raw_slots (component-rationale)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const cols = db.prepare('PRAGMA table_info(raw_slots)').all() as Array<{
        name: string;
        notnull: number;
      }>;
      const byName = new Map(cols.map((c) => [c.name, c]));
      expect(byName.has('rationale')).toBe(true);
      expect(byName.get('rationale')!.notnull).toBe(0);
      db.close();
    });
  });

  it('component-rationale migrations are idempotent across opens', async () => {
    await withTempDb((dbPath) => {
      const db1 = openPipelineDb(dbPath);
      db1.close();
      const db2 = openPipelineDb(dbPath);
      const compCols = db2.prepare('PRAGMA table_info(raw_components)').all() as Array<{ name: string }>;
      const compNames = compCols.map((c) => c.name);
      expect(compNames.filter((n) => n === 'component_description_rationale').length).toBe(1);
      expect(compNames.filter((n) => n === 'props_rationale').length).toBe(1);
      expect(compNames.filter((n) => n === 'slots_rationale').length).toBe(1);
      const slotCols = db2.prepare('PRAGMA table_info(raw_slots)').all() as Array<{ name: string }>;
      expect(slotCols.map((c) => c.name).filter((n) => n === 'rationale').length).toBe(1);
      db2.close();
    });
  });

  it('loadComponentRationale returns expected shape for a populated component', async () => {
    const { loadComponentRationale } = await import('../../src/session/db.js');
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const components: RawComponentDefinition[] = [
        {
          name: 'Hero',
          source: 'src',
          framework: 'react',
          props: [{ name: 'title', type: 'string', required: true, category: 'content', description: 'Headline' }],
          slots: [{ name: 'media', isDefault: false, description: 'Background media' }],
        },
      ];
      storeRawComponents(db, sessionId, components);
      const compId = (
        db
          .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?`)
          .get(sessionId, 'Hero') as { component_id: string }
      ).component_id;
      db.prepare(
        `UPDATE raw_components SET description = ?, component_description_rationale = ?, props_rationale = ?, slots_rationale = ? WHERE session_id = ? AND component_id = ?`,
      ).run('A hero block.', 'why-desc', 'why-props', 'why-slots', sessionId, compId);
      db.prepare(`UPDATE raw_props SET rationale = ? WHERE session_id = ? AND component_id = ? AND name = ?`).run(
        'content-text',
        sessionId,
        compId,
        'title',
      );
      db.prepare(`UPDATE raw_slots SET rationale = ? WHERE session_id = ? AND component_id = ? AND name = ?`).run(
        'keep-this-slot',
        sessionId,
        compId,
        'media',
      );

      const r = loadComponentRationale(db, sessionId, 'Hero');
      expect(r).not.toBeNull();
      expect(r!.name).toBe('Hero');
      expect(r!.description).toBe('A hero block.');
      expect(r!.descriptionRationale).toBe('why-desc');
      expect(r!.propsRationale).toBe('why-props');
      expect(r!.slotsRationale).toBe('why-slots');
      expect(r!.props).toHaveLength(1);
      expect(r!.props[0]).toMatchObject({
        name: 'title',
        category: 'content',
        description: 'Headline',
        rationale: 'content-text',
      });
      expect(r!.slots).toHaveLength(1);
      expect(r!.slots[0]).toMatchObject({
        name: 'media',
        description: 'Background media',
        rationale: 'keep-this-slot',
      });
      db.close();
    });
  });

  it('loadComponentRationale returns null rationale fields when columns are NULL', async () => {
    const { loadComponentRationale } = await import('../../src/session/db.js');
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const components: RawComponentDefinition[] = [
        {
          name: 'Bare',
          source: 'src',
          framework: 'react',
          props: [{ name: 'a', type: 'string', required: false }],
          slots: [{ name: 's', isDefault: false }],
        },
      ];
      storeRawComponents(db, sessionId, components);
      const r = loadComponentRationale(db, sessionId, 'Bare');
      expect(r).not.toBeNull();
      expect(r!.descriptionRationale).toBeNull();
      expect(r!.propsRationale).toBeNull();
      expect(r!.slotsRationale).toBeNull();
      expect(r!.description).toBeNull();
      expect(r!.props[0]?.rationale).toBeNull();
      expect(r!.slots[0]?.rationale).toBeNull();
      db.close();
    });
  });

  it('loadComponentRationale returns null when component is missing', async () => {
    const { loadComponentRationale } = await import('../../src/session/db.js');
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const r = loadComponentRationale(db, sessionId, 'Nope');
      expect(r).toBeNull();
      db.close();
    });
  });

  it('loadComponentReviewMetadata returns null when component is missing (Feature 1)', async () => {
    const { loadComponentReviewMetadata } = await import('../../src/session/db.js');
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const meta = loadComponentReviewMetadata(db, sessionId, 'Nonexistent');
      expect(meta).toBeNull();
      db.close();
    });
  });

  it('loadRawComponents surfaces sourcePath and per-prop source lines (Feature 1)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      const components: RawComponentDefinition[] = [
        {
          name: 'Button',
          source: 'src',
          framework: 'react',
          sourcePath: '/proj/Button.tsx',
          props: [
            {
              name: 'label',
              type: 'string',
              required: true,
              sourceStartLine: 3,
              sourceEndLine: 3,
            },
          ],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, components);
      const loaded = loadRawComponents(db, sessionId);
      expect(loaded[0]?.sourcePath).toBe('/proj/Button.tsx');
      expect(loaded[0]?.props[0]?.sourceStartLine).toBe(3);
      expect(loaded[0]?.props[0]?.sourceEndLine).toBe(3);
      db.close();
    });
  });
});

describe('storeCDFComponents + loadCDFComponents', () => {
  const RAW: RawComponentDefinition[] = [
    {
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react',
      props: [
        { name: 'label', type: 'string', required: true, category: 'content' },
        {
          name: 'variant',
          type: "'primary' | 'secondary'",
          required: false,
          category: 'design',
          allowedValues: ['primary', 'secondary'],
        },
      ],
      slots: [{ name: 'icon', isDefault: false, description: 'Optional icon' }],
    },
  ];

  const CDF_COMPONENTS: Array<{ key: string; entry: CDFComponentEntry }> = [
    {
      key: 'Button',
      entry: {
        $type: 'component',
        $description: 'A button component',
        $properties: {
          label: { $type: 'string', $category: 'content', $required: true },
          variant: { $type: 'enum', $category: 'design', $values: ['primary', 'secondary'] },
        },
        $slots: {
          icon: { $description: 'Optional icon' },
        },
      },
    },
  ];

  it('stores CDF data and loads it back', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.key).toBe('Button');
      expect(loaded[0]?.entry.$type).toBe('component');
      expect(loaded[0]?.entry.$description).toBe('A button component');
      expect(loaded[0]?.entry.$properties['label']?.$type).toBe('string');
      expect(loaded[0]?.entry.$properties['label']?.$category).toBe('content');
      expect(loaded[0]?.entry.$properties['label']?.$required).toBe(true);
      expect(loaded[0]?.entry.$properties['variant']?.$type).toBe('enum');
      expect(loaded[0]?.entry.$properties['variant']?.$values).toEqual(['primary', 'secondary']);
      expect(loaded[0]?.entry.$slots?.['icon']?.$description).toBe('Optional icon');
      db.close();
    });
  });

  it('loadCDFComponents returns empty before storeCDFComponents is called', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, RAW);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(0);
      db.close();
    });
  });

  it('marks component status as generated after storeCDFComponents', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      const row = db
        .prepare(`SELECT status FROM raw_components WHERE session_id = ? AND name = 'Button'`)
        .get(sessionId) as { status: string } | undefined;
      expect(row?.status).toBe('generated');
      db.close();
    });
  });

  it('stores and loads $values for an agent-added component (new-component path)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeCDFComponents(db, sessionId, [
        {
          key: 'Badge',
          entry: {
            $type: 'component',
            $properties: {
              variant: { $type: 'enum', $category: 'design', $values: ['success', 'warning', 'error'] },
            },
            $slots: {
              content: { $description: 'Badge content', $allowedComponents: ['Icon', 'Text'] },
            },
          },
        },
      ]);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.key).toBe('Badge');
      expect(loaded[0]?.entry.$properties['variant']?.$values).toEqual(['success', 'warning', 'error']);
      expect(loaded[0]?.entry.$slots?.['content']?.$allowedComponents).toEqual(['Icon', 'Text']);
      db.close();
    });
  });

  it('updates $values when storeCDFComponents is called again on an existing component', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              label: { $type: 'string', $category: 'content' },
              variant: { $type: 'enum', $category: 'design', $values: ['primary', 'secondary', 'danger'] },
            },
          },
        },
      ]);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties['variant']?.$values).toEqual(['primary', 'secondary', 'danger']);
      db.close();
    });
  });

  describe('slot persistence on update path (INTEG-4401)', () => {
    const RAW_CYCLE: RawComponentDefinition[] = [
      {
        name: 'CycleA',
        source: 'src/CycleA.tsx',
        framework: 'react',
        props: [],
        slots: [{ name: 'slotB', isDefault: false, description: 'child slot' }],
      },
    ];

    const seedCycleA = (db: ReturnType<typeof openPipelineDb>, sessionId: string) => {
      storeRawComponents(db, sessionId, RAW_CYCLE);
      storeCDFComponents(db, sessionId, [
        {
          key: 'CycleA',
          entry: {
            $type: 'component',
            $properties: {},
            $slots: {
              slotB: { $allowedComponents: ['A', 'B'] },
            },
          },
        },
      ]);
    };

    it('persists removal of a $allowedComponents entry on an existing component', async () => {
      await withTempDb((dbPath) => {
        const db = openPipelineDb(dbPath);
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        seedCycleA(db, sessionId);

        storeCDFComponents(db, sessionId, [
          {
            key: 'CycleA',
            entry: {
              $type: 'component',
              $properties: {},
              $slots: {
                slotB: { $allowedComponents: ['A'] },
              },
            },
          },
        ]);

        const loaded = loadCDFComponents(db, sessionId);
        expect(loaded[0]?.entry.$slots?.['slotB']?.$allowedComponents).toEqual(['A']);
        db.close();
      });
    });

    it('persists addition of a $allowedComponents entry on an existing component', async () => {
      await withTempDb((dbPath) => {
        const db = openPipelineDb(dbPath);
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        seedCycleA(db, sessionId);

        storeCDFComponents(db, sessionId, [
          {
            key: 'CycleA',
            entry: {
              $type: 'component',
              $properties: {},
              $slots: {
                slotB: { $allowedComponents: ['A', 'B', 'C'] },
              },
            },
          },
        ]);

        const loaded = loadCDFComponents(db, sessionId);
        expect(loaded[0]?.entry.$slots?.['slotB']?.$allowedComponents).toEqual(['A', 'B', 'C']);
        db.close();
      });
    });

    it('removes a slot entirely when omitted from a subsequent storeCDFComponents call', async () => {
      await withTempDb((dbPath) => {
        const db = openPipelineDb(dbPath);
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        seedCycleA(db, sessionId);

        storeCDFComponents(db, sessionId, [
          {
            key: 'CycleA',
            entry: {
              $type: 'component',
              $properties: {},
              $slots: {},
            },
          },
        ]);

        const componentId = (db
          .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
          .get(sessionId, 'CycleA') as { component_id: string } | undefined)!.component_id;
        const slotRows = db
          .prepare('SELECT name FROM raw_slots WHERE session_id = ? AND component_id = ?')
          .all(sessionId, componentId) as Array<{ name: string }>;
        expect(slotRows).toHaveLength(0);

        const acRows = db
          .prepare(
            'SELECT allowed_component FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ?',
          )
          .all(sessionId, componentId) as Array<{ allowed_component: string }>;
        expect(acRows).toHaveLength(0);
        db.close();
      });
    });

    it('preserves is_default on a slot across an edit that only changes $allowedComponents', async () => {
      await withTempDb((dbPath) => {
        const db = openPipelineDb(dbPath);
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        storeRawComponents(db, sessionId, [
          {
            name: 'Card',
            source: 'src/Card.tsx',
            framework: 'react',
            props: [],
            slots: [{ name: 'children', isDefault: true, description: 'default slot' }],
          },
        ]);
        storeCDFComponents(db, sessionId, [
          {
            key: 'Card',
            entry: {
              $type: 'component',
              $properties: {},
              $slots: {
                children: { $allowedComponents: ['A', 'B'] },
              },
            },
          },
        ]);

        storeCDFComponents(db, sessionId, [
          {
            key: 'Card',
            entry: {
              $type: 'component',
              $properties: {},
              $slots: {
                children: { $allowedComponents: ['A'] },
              },
            },
          },
        ]);

        const componentId = (db
          .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
          .get(sessionId, 'Card') as { component_id: string } | undefined)!.component_id;
        const slotRow = db
          .prepare('SELECT name, is_default FROM raw_slots WHERE session_id = ? AND component_id = ? AND name = ?')
          .get(sessionId, componentId, 'children') as { name: string; is_default: number } | undefined;
        expect(slotRow?.is_default).toBe(1);

        const loaded = loadCDFComponents(db, sessionId);
        expect(loaded[0]?.entry.$slots?.['children']?.$allowedComponents).toEqual(['A']);
        db.close();
      });
    });
  });
});

describe('CDF builder: $token.sets / $token.allowed (INTEG-4686)', () => {
  const RAW: RawComponentDefinition[] = [
    {
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react',
      props: [
        { name: 'label', type: 'string', required: true, category: 'content' },
        {
          name: 'variant',
          type: "'primary' | 'secondary'",
          required: false,
          category: 'design',
          allowedValues: ['primary', 'secondary'],
        },
      ],
      slots: [{ name: 'icon', isDefault: false, description: 'Optional icon' }],
    },
  ];

  const CDF_COMPONENTS: Array<{ key: string; entry: CDFComponentEntry }> = [
    {
      key: 'Button',
      entry: {
        $type: 'component',
        $description: 'A button component',
        $properties: {
          label: { $type: 'string', $category: 'content', $required: true },
          variant: { $type: 'token', $category: 'design', $values: ['primary', 'secondary'] },
        },
        $slots: {
          icon: { $description: 'Optional icon' },
        },
      },
    },
  ];

  it('attaches $token.allowed on token-typed props', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              variant: {
                $type: 'token',
                $category: 'design',
                '$token.kind': 'color',
                '$token.allowed': ['color.brand.primary', 'color.brand.secondary'],
              },
            },
          },
        },
      ]);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties['variant']?.['$token.allowed']).toEqual([
        'color.brand.primary',
        'color.brand.secondary',
      ]);
      expect(
        validateCDF({
          $schema: CDF_V1_SCHEMA_URL,
          ...Object.fromEntries(loaded.map(({ key, entry }) => [key, entry])),
        }).valid,
      ).toBe(true);
      db.close();
    });
  });

  it('omits $token.sets and $token.allowed entirely when no mapping was ever run', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties['variant']).not.toHaveProperty('$token.sets');
      expect(loaded[0]?.entry.$properties['variant']).not.toHaveProperty('$token.allowed');
      db.close();
    });
  });

  it('collapses a persisted empty $token.allowed to absent, same as never mapped', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              variant: { $type: 'token', $category: 'design', '$token.allowed': [] },
            },
          },
        },
      ]);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties['variant']).not.toHaveProperty('$token.allowed');
      expect(loaded[0]?.entry.$properties['variant']).not.toHaveProperty('$token.sets');
      db.close();
    });
  });

  it('drops the extracted variant vocabulary for a token prop with no mapping', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toEqual([
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $description: 'A button component',
            $properties: {
              label: { $type: 'string', $category: 'content', $required: true },
              variant: { $type: 'token', $category: 'design' },
            },
            $slots: {
              icon: { $description: 'Optional icon' },
            },
          },
        },
      ]);
      db.close();
    });
  });

  it('emits only $token.allowed for a token prop — the universe is not serialised', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const tokens = [
        { path: 'color.brand.primary', $type: 'color' as const, $value: '#000' },
        { path: 'color.brand.secondary', $type: 'color' as const, $value: '#111' },
        { path: 'spacing.md', $type: 'dimension' as const, $value: '12px' },
      ];
      storeDTCGTokens(db, sessionId, [], tokens);
      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              variant: {
                $type: 'token',
                $category: 'design',
                '$token.kind': 'color',
                '$token.allowed': ['color.brand.primary'],
              },
            },
          },
        },
      ]);

      const loaded = loadCDFComponents(db, sessionId);
      const prop = loaded[0]?.entry.$properties['variant'];
      expect(prop?.['$token.allowed']).toEqual(['color.brand.primary']);
      expect(prop).not.toHaveProperty('$token.sets');
      expect(prop?.['$token.kind']).toBe('color');

      // The emitted CDF validates against the same session's token document,
      // which is what a consumer resolves the universe from.
      const cdf = {
        $schema: CDF_V1_SCHEMA_URL,
        ...Object.fromEntries(loaded.map(({ key, entry }) => [key, entry])),
      };
      expect(validateCDF(cdf).valid).toBe(true);
      expect(validateCDF(cdf, { tokens: rebuildDTCGTree([], tokens) }).valid).toBe(true);
      db.close();
    });
  });

  it("omits $token.sets when no raw token matches the prop's $token.kind", async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeDTCGTokens(db, sessionId, [], [{ path: 'spacing.md', $type: 'dimension', $value: '12px' }]);
      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              variant: { $type: 'token', $category: 'design', '$token.kind': 'color' },
            },
          },
        },
      ]);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties['variant']).not.toHaveProperty('$token.sets');
      db.close();
    });
  });

  it('round-trips $token.allowed through an import --modify replay and re-print', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const cdfWithMappings: Array<{ key: string; entry: CDFComponentEntry }> = [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              variant: {
                $type: 'token',
                $category: 'design',
                '$token.kind': 'color',
                '$token.allowed': ['color.brand.primary'],
              },
            },
          },
        },
      ];

      storeCDFComponents(db, sessionId, cdfWithMappings);
      const printed = loadCDFComponents(db, sessionId);

      const componentId = (db
        .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
        .get(sessionId, 'Button') as { component_id: string } | undefined)!.component_id;
      const rows = db
        .prepare(
          `SELECT kind, position, path FROM raw_prop_token_paths
           WHERE session_id = ? AND component_id = ? AND prop_name = ? ORDER BY kind, position`,
        )
        .all(sessionId, componentId, 'variant');
      // $token.allowed paths are stored with kind='allowed'
      expect(rows).toEqual([{ kind: 'allowed', position: 0, path: 'color.brand.primary' }]);
      expect(printed[0]?.entry.$properties['variant']?.['$token.allowed']).toEqual(['color.brand.primary']);

      // Reimport the printed CDF verbatim, as `import --modify` would replay it.
      storeCDFComponents(db, sessionId, printed);
      const reprinted = loadCDFComponents(db, sessionId);
      expect(reprinted).toEqual(printed);
    });
  });

  it('clears persisted allowed paths when a reviewed token prop omits the field', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const mapped = [
        {
          key: 'Button',
          entry: {
            $type: 'component' as const,
            $properties: {
              background: {
                $type: 'token' as const,
                $category: 'design' as const,
                '$token.kind': 'color',
                '$token.allowed': ['color.brand.primary'],
              },
              foreground: {
                $type: 'token' as const,
                $category: 'design' as const,
                '$token.kind': 'color',
                '$token.allowed': ['color.brand.secondary'],
              },
            },
          },
        },
      ];

      storeCDFComponents(db, sessionId, mapped);
      const componentId = (
        db
          .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
          .get(sessionId, 'Button') as { component_id: string }
      ).component_id;

      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            ...mapped[0].entry,
            $properties: {
              background: {
                $type: 'token',
                $category: 'design',
                '$token.kind': 'color',
              },
              foreground: mapped[0].entry.$properties.foreground,
            },
          },
        },
      ]);

      const rows = db
        .prepare(
          `SELECT prop_name, kind, path FROM raw_prop_token_paths
           WHERE session_id = ? AND component_id = ? ORDER BY prop_name, position`,
        )
        .all(sessionId, componentId);
      expect(rows).toEqual([{ prop_name: 'foreground', kind: 'allowed', path: 'color.brand.secondary' }]);
      db.close();

      const reloadedDb = openPipelineDb(dbPath);
      const reloadedRows = reloadedDb
        .prepare(
          `SELECT prop_name, kind, path FROM raw_prop_token_paths
           WHERE session_id = ? AND component_id = ? ORDER BY prop_name, position`,
        )
        .all(sessionId, componentId);
      expect(reloadedRows).toEqual([{ prop_name: 'foreground', kind: 'allowed', path: 'color.brand.secondary' }]);
      const loaded = loadCDFComponents(reloadedDb, sessionId);
      expect(loaded[0]?.entry.$properties.background).not.toHaveProperty('$token.allowed');
      expect(loaded[0]?.entry.$properties.foreground?.['$token.allowed']).toEqual(['color.brand.secondary']);
      reloadedDb.close();
    });
  });

  it('keeps path ordering stable across repeated loads', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              variant: {
                $type: 'token',
                $category: 'design',
                '$token.kind': 'color',
                '$token.allowed': ['color.brand.tertiary', 'color.brand.primary', 'color.brand.secondary'],
              },
            },
          },
        },
      ]);

      const first = loadCDFComponents(db, sessionId);
      const second = loadCDFComponents(db, sessionId);
      expect(first[0]?.entry.$properties['variant']?.['$token.allowed']).toEqual([
        'color.brand.tertiary',
        'color.brand.primary',
        'color.brand.secondary',
      ]);
      expect(second).toEqual(first);
      db.close();
    });
  });

  it('omits mappings stored for a non-token property', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $properties: {
              variant: {
                $type: 'enum',
                $category: 'design',
                $values: ['primary', 'secondary'],
              },
            },
          },
        },
      ]);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties.variant).not.toHaveProperty('$token.allowed');
      db.close();
    });
  });

  it('emits $token.allowed and suppresses $values on a token prop', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Badge',
          source: 'src/Badge.tsx',
          framework: 'react',
          props: [
            {
              name: 'variant',
              type: "'primary' | 'danger'",
              required: false,
              category: 'design',
              // Vocabulary captured at extraction time must not reach the CDF.
              allowedValues: ['primary', 'danger'],
            },
          ],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0]!.component_id;
      db.prepare(
        `UPDATE raw_props SET cdf_type = 'token', cdf_category = 'design', cdf_token_kind = 'color'
         WHERE session_id = ? AND component_id = ? AND name = 'variant'`,
      ).run(sessionId, componentId);
      replaceRawPropTokenPaths(
        db,
        sessionId,
        componentId,
        'variant',
        'allowed',
        ['color.blue.500', 'color.red.500'],
        'agent',
      );
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND component_id = ?`).run(
        sessionId,
        componentId,
      );

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties['variant']?.['$token.allowed']).toEqual(['color.blue.500', 'color.red.500']);
      expect(loaded[0]?.entry.$properties['variant']?.$values).toBeUndefined();
      expect(loaded[0]?.entry.$properties['variant']).not.toHaveProperty('$token.sets');
      db.close();
    });
  });

  it('still emits $values on an enum prop', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Layout',
          source: 'src/Layout.tsx',
          framework: 'react',
          props: [
            {
              name: 'orientation',
              type: "'row' | 'column'",
              required: false,
              category: 'design',
              allowedValues: ['row', 'column'],
            },
          ],
          slots: [],
        },
      ]);
      const componentId = loadRawComponents(db, sessionId)[0]!.component_id;
      db.prepare(
        `UPDATE raw_props SET cdf_type = 'enum', cdf_category = 'design'
         WHERE session_id = ? AND component_id = ? AND name = 'orientation'`,
      ).run(sessionId, componentId);
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND component_id = ?`).run(
        sessionId,
        componentId,
      );

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded[0]?.entry.$properties['orientation']?.$values).toEqual(['row', 'column']);
      db.close();
    });
  });
});

describe('storeRawComponents preserveCDF option', () => {
  const RAW: RawComponentDefinition[] = [
    {
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react',
      props: [
        { name: 'label', type: 'string', required: true, category: 'content' },
        {
          name: 'variant',
          type: "'primary' | 'secondary'",
          required: false,
          category: 'design',
          allowedValues: ['primary', 'secondary'],
        },
        { name: 'disabled', type: 'boolean', required: false, category: 'content' },
      ],
      slots: [{ name: 'icon', isDefault: false, description: 'Optional icon' }],
    },
  ];

  const CDF_COMPONENTS: Array<{ key: string; entry: CDFComponentEntry }> = [
    {
      key: 'Button',
      entry: {
        $type: 'component',
        $description: 'A reusable button',
        $properties: {
          label: { $type: 'string', $category: 'content', $required: true },
          variant: { $type: 'enum', $category: 'design', $values: ['primary', 'secondary'] },
          disabled: { $type: 'string', $category: 'content' },
        },
        $slots: { icon: { $description: 'Optional icon' } },
      },
    },
  ];

  it('retains CDF for unchanged props when preserveCDF is true', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      storeRawComponents(db, sessionId, RAW, { status: 'generated', preserveCDF: true });

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.key).toBe('Button');
      expect(loaded[0]?.entry.$properties['label']?.$type).toBe('string');
      expect(loaded[0]?.entry.$properties['label']?.$category).toBe('content');
      expect(loaded[0]?.entry.$properties['label']?.$required).toBe(true);
      expect(loaded[0]?.entry.$properties['variant']?.$type).toBe('enum');
      expect(loaded[0]?.entry.$properties['variant']?.$values).toEqual(['primary', 'secondary']);
      expect(loaded[0]?.entry.$properties['disabled']?.$type).toBe('string');
      expect(loaded[0]?.entry.$description).toBe('A reusable button');
      db.close();
    });
  });

  it('drops CDF for removed props when preserveCDF is true', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      const edited: RawComponentDefinition[] = [
        {
          ...RAW[0]!,
          props: RAW[0]!.props.filter((p) => p.name !== 'disabled'),
        },
      ];
      storeRawComponents(db, sessionId, edited, { status: 'generated', preserveCDF: true });

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(1);
      const propNames = Object.keys(loaded[0]!.entry.$properties);
      expect(propNames).toContain('label');
      expect(propNames).toContain('variant');
      expect(propNames).not.toContain('disabled');
      db.close();
    });
  });

  it('preserves CDF for renamed props via position fallback when preserveCDF is true', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      const edited: RawComponentDefinition[] = [
        {
          ...RAW[0]!,
          props: RAW[0]!.props.map((p) => (p.name === 'variant' ? { ...p, name: 'theme' } : p)),
        },
      ];
      storeRawComponents(db, sessionId, edited, { status: 'generated', preserveCDF: true });

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(1);
      const propNames = Object.keys(loaded[0]!.entry.$properties);
      expect(propNames).toContain('label');
      expect(propNames).toContain('disabled');
      expect(propNames).toContain('theme');
      expect(propNames).not.toContain('variant');
      db.close();
    });
  });

  it('handles new components with no prior CDF data', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      const withNew: RawComponentDefinition[] = [
        ...RAW,
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'title', type: 'string', required: true }],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, withNew, { status: 'generated', preserveCDF: true });

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(2);
      const button = loaded.find((c) => c.key === 'Button');
      const card = loaded.find((c) => c.key === 'Card');
      expect(button).toBeDefined();
      expect(Object.keys(button!.entry.$properties)).toHaveLength(3);
      expect(card).toBeDefined();
      expect(Object.keys(card!.entry.$properties)).toHaveLength(0);
      db.close();
    });
  });

  it('wipes CDF when preserveCDF is not set (default behavior unchanged)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      storeRawComponents(db, sessionId, RAW);
      storeCDFComponents(db, sessionId, CDF_COMPONENTS);

      storeRawComponents(db, sessionId, RAW);

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(0);
      db.close();
    });
  });
});

describe('seedCDFFromPriorSession', () => {
  const RAW: RawComponentDefinition[] = [
    {
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react',
      props: [
        { name: 'label', type: 'string', required: true, category: 'content' },
        { name: 'variant', type: "'primary' | 'secondary'", required: false, category: 'design' },
      ],
      slots: [],
    },
  ];

  const CDF: Array<{ key: string; entry: CDFComponentEntry }> = [
    {
      key: 'Button',
      entry: {
        $type: 'component',
        $description: 'A button',
        $properties: {
          label: { $type: 'string', $category: 'content', $required: true },
          variant: { $type: 'enum', $category: 'design', $values: ['primary', 'secondary'] },
        },
      },
    },
  ];

  it('copies CDF data from a prior generate session into the target session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);

      const { sessionId: priorId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
      storeRawComponents(db, priorId, RAW);
      storeCDFComponents(db, priorId, CDF);
      const stepId = createStep(db, priorId, 'generate components', {});
      updateStep(db, stepId, 'complete', {});

      const { sessionId: targetId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, targetId, RAW);

      const seeded = seedCDFFromPriorSession(db, targetId);
      expect(seeded).toBe(2);

      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(targetId);

      const loaded = loadCDFComponents(db, targetId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.entry.$properties['label']?.$type).toBe('string');
      expect(loaded[0]?.entry.$properties['label']?.$category).toBe('content');
      expect(loaded[0]?.entry.$properties['variant']?.$type).toBe('enum');
      expect(loaded[0]?.entry.$properties['variant']?.$values).toEqual(['primary', 'secondary']);
      expect(loaded[0]?.entry.$description).toBe('A button');
      db.close();
    });
  });

  it('returns 0 when no prior generate session exists', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, RAW);
      expect(seedCDFFromPriorSession(db, sessionId)).toBe(0);
      db.close();
    });
  });

  it('only seeds props that match by component_id and name', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);

      const { sessionId: priorId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
      storeRawComponents(db, priorId, RAW);
      storeCDFComponents(db, priorId, CDF);
      const stepId = createStep(db, priorId, 'generate components', {});
      updateStep(db, stepId, 'complete', {});

      const targetRaw: RawComponentDefinition[] = [
        {
          ...RAW[0]!,
          props: [
            { name: 'label', type: 'string', required: true, category: 'content' },
            { name: 'theme', type: 'string', required: false, category: 'design' },
          ],
        },
      ];
      const { sessionId: targetId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, targetId, targetRaw);

      const seeded = seedCDFFromPriorSession(db, targetId);
      expect(seeded).toBe(1);

      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(targetId);
      const loaded = loadCDFComponents(db, targetId);
      expect(Object.keys(loaded[0]!.entry.$properties)).toEqual(['label']);
      db.close();
    });
  });
});

describe('storeDTCGTokens / loadDTCGTokens', () => {
  it('round-trips groups and tokens', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      const groups: DTCGTokenGroup[] = [
        { path: 'color', tokenIds: [], $description: 'Color palette' },
        { path: 'color.primary', tokenIds: [] },
      ];
      const tokens: DTCGTokenEntry[] = [
        { path: 'color.primary.500', $type: 'color', $value: '#3b82f6', $description: 'Base blue' },
        { path: 'color.primary.600', $type: 'color', $value: '#2563eb' },
      ];

      storeDTCGTokens(db, sessionId, groups, tokens);
      const result = loadDTCGTokens(db, sessionId);

      expect(result.groups).toHaveLength(2);
      expect(result.groups.find((g) => g.path === 'color')?.$description).toBe('Color palette');
      expect(result.groups.find((g) => g.path === 'color.primary')?.$description).toBeUndefined();

      expect(result.tokens).toHaveLength(2);
      const t500 = result.tokens.find((t) => t.path === 'color.primary.500');
      expect(t500?.$type).toBe('color');
      expect(t500?.$value).toBe('#3b82f6');
      expect(t500?.$description).toBe('Base blue');
      const t600 = result.tokens.find((t) => t.path === 'color.primary.600');
      expect(t600?.$value).toBe('#2563eb');
      expect(t600?.$description).toBeUndefined();
      db.close();
    });
  });

  it('round-trips complex $value types (arrays, objects)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      const gradientValue = [
        { color: '#ff0000', position: 0 },
        { color: '#0000ff', position: 1 },
      ];
      const shadowValue = { color: '#000', offsetX: 0, offsetY: 2, blur: 4, spread: 0 };

      storeDTCGTokens(
        db,
        sessionId,
        [],
        [
          { path: 'effects.gradient', $type: 'gradient', $value: gradientValue },
          { path: 'effects.shadow', $type: 'shadow', $value: shadowValue },
        ],
      );

      const { tokens } = loadDTCGTokens(db, sessionId);
      expect(tokens.find((t) => t.path === 'effects.gradient')?.$value).toEqual(gradientValue);
      expect(tokens.find((t) => t.path === 'effects.shadow')?.$value).toEqual(shadowValue);
      db.close();
    });
  });

  it('tokenIds on groups reflects direct child tokens', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      storeDTCGTokens(
        db,
        sessionId,
        [
          { path: 'color', tokenIds: [] },
          { path: 'color.brand', tokenIds: [] },
        ],
        [
          { path: 'color.base', $type: 'color', $value: '#fff' },
          { path: 'color.brand.primary', $type: 'color', $value: '#000' },
        ],
      );

      const { groups } = loadDTCGTokens(db, sessionId);
      const colorGroup = groups.find((g) => g.path === 'color');
      expect(colorGroup?.tokenIds).toEqual(['color.base']);
      const brandGroup = groups.find((g) => g.path === 'color.brand');
      expect(brandGroup?.tokenIds).toEqual(['color.brand.primary']);
      db.close();
    });
  });

  it('re-storing replaces existing tokens (idempotent)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      storeDTCGTokens(
        db,
        sessionId,
        [],
        [
          { path: 'spacing.sm', $type: 'dimension', $value: '4px' },
          { path: 'spacing.md', $type: 'dimension', $value: '8px' },
        ],
      );
      storeDTCGTokens(db, sessionId, [], [{ path: 'spacing.md', $type: 'dimension', $value: '12px' }]);

      const { tokens } = loadDTCGTokens(db, sessionId);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.path).toBe('spacing.md');
      expect(tokens[0]?.$value).toBe('12px');
      db.close();
    });
  });

  it('isolates tokens by session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: sid1 } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });
      const { sessionId: sid2 } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      storeDTCGTokens(db, sid1, [], [{ path: 'a.token', $type: 'color', $value: '#aaa' }]);
      storeDTCGTokens(db, sid2, [], [{ path: 'b.token', $type: 'color', $value: '#bbb' }]);

      expect(loadDTCGTokens(db, sid1).tokens.map((t) => t.path)).toEqual(['a.token']);
      expect(loadDTCGTokens(db, sid2).tokens.map((t) => t.path)).toEqual(['b.token']);
      db.close();
    });
  });

  it('returns empty arrays when session has no tokens', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });
      const result = loadDTCGTokens(db, sessionId);
      expect(result.groups).toHaveLength(0);
      expect(result.tokens).toHaveLength(0);
      db.close();
    });
  });
});

describe('findLatestSessionForCommand', () => {
  it('returns null when no sessions exist', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      expect(findLatestSessionForCommand(db, 'generate components')).toBeNull();
      db.close();
    });
  });

  it('returns null when no complete step exists for the command', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
      createStep(db, sessionId, 'generate components', {});
      expect(findLatestSessionForCommand(db, 'generate components')).toBeNull();
      db.close();
    });
  });

  it('returns the session ID of a complete step', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
      const stepId = createStep(db, sessionId, 'generate components', {});
      updateStep(db, stepId, 'complete', {});
      expect(findLatestSessionForCommand(db, 'generate components')).toBe(sessionId);
      db.close();
    });
  });

  it('returns the most recent session when multiple have complete steps', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: sid1 } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
      const step1 = createStep(db, sid1, 'generate components', {});
      updateStep(db, step1, 'complete', {});

      const { sessionId: sid2 } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
      const step2 = createStep(db, sid2, 'generate components', {});
      updateStep(db, step2, 'complete', {});

      expect(findLatestSessionForCommand(db, 'generate components')).toBe(sid2);
      db.close();
    });
  });

  it('ignores failed and pending steps', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
      const step = createStep(db, sessionId, 'generate components', {});
      updateStep(db, step, 'failed', {});
      expect(findLatestSessionForCommand(db, 'generate components')).toBeNull();
      db.close();
    });
  });
});

describe('seedCDFFromPreviewResponse', () => {
  it('seeds cdf_type and cdf_category from server fullProperties', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'import' });
        db.exec(`INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, status)
                 VALUES ('${sessionId}', 'comp1', 'AppMegaMenu', 'src/App.tsx', 'react', '2026-01-01', 'generated')`);
        db.exec(`INSERT INTO raw_props (session_id, component_id, name, type, required, position)
                 VALUES ('${sessionId}', 'comp1', 'active', 'boolean', 1, 0)`);
        db.exec(`INSERT INTO raw_props (session_id, component_id, name, type, required, position)
                 VALUES ('${sessionId}', 'comp1', 'label', 'string', 0, 1)`);

        const removedItems: ComponentTypeSummary[] = [
          {
            id: 'ct-appMegaMenu',
            name: 'AppMegaMenu',
            contentProperties: ['label'],
            designProperties: [],
            slots: [],
            fullProperties: {
              active: { type: 'string', category: 'state', required: true },
              label: { type: 'string', category: 'content', required: false },
            },
          },
        ];

        const seeded = seedCDFFromPreviewResponse(db, sessionId, removedItems);
        expect(seeded).toBe(2);

        const props = db
          .prepare(`SELECT name, cdf_type, cdf_category FROM raw_props WHERE session_id = ? ORDER BY name`)
          .all(sessionId) as Array<{ name: string; cdf_type: string | null; cdf_category: string | null }>;

        expect(props).toEqual([
          { name: 'active', cdf_type: 'string', cdf_category: 'state' },
          { name: 'label', cdf_type: 'string', cdf_category: 'content' },
        ]);
      } finally {
        db.close();
      }
    });
  });

  it('skips props that already have cdf_type set', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'import' });
        db.exec(`INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, status)
                 VALUES ('${sessionId}', 'comp1', 'Foo', 'src/Foo.tsx', 'react', '2026-01-01', 'generated')`);
        db.exec(`INSERT INTO raw_props (session_id, component_id, name, type, required, position, cdf_type, cdf_category)
                 VALUES ('${sessionId}', 'comp1', 'color', 'string', 0, 0, 'token', 'design')`);

        const removedItems: ComponentTypeSummary[] = [
          {
            id: 'ct-foo',
            name: 'Foo',
            contentProperties: ['color'],
            designProperties: [],
            slots: [],
            fullProperties: {
              color: { type: 'string', category: 'content', required: false },
            },
          },
        ];

        const seeded = seedCDFFromPreviewResponse(db, sessionId, removedItems);
        expect(seeded).toBe(0);

        const props = db
          .prepare(`SELECT name, cdf_type, cdf_category FROM raw_props WHERE session_id = ?`)
          .all(sessionId) as Array<{ name: string; cdf_type: string | null; cdf_category: string | null }>;

        expect(props).toEqual([{ name: 'color', cdf_type: 'token', cdf_category: 'design' }]);
      } finally {
        db.close();
      }
    });
  });

  it('only seeds props for components that exist in the session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'import' });

        const removedItems: ComponentTypeSummary[] = [
          {
            id: 'ct-ghost',
            name: 'GhostComponent',
            contentProperties: ['x'],
            designProperties: [],
            slots: [],
            fullProperties: { x: { type: 'string', category: 'content', required: false } },
          },
        ];

        const seeded = seedCDFFromPreviewResponse(db, sessionId, removedItems);
        expect(seeded).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it('returns 0 when removed list is empty', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      try {
        const seeded = seedCDFFromPreviewResponse(db, 'nonexistent', []);
        expect(seeded).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});

describe('backfillUnclassifiedProps', () => {
  it('does not override props excluded by the AI generation step', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      const raw: RawComponentDefinition[] = [
        {
          name: 'Widget',
          source: 'src/Widget.tsx',
          framework: 'react',
          props: [
            { name: 'title', type: 'string', required: true },
            { name: 'internalRef', type: 'Ref<HTMLElement>', required: false },
          ],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, raw);

      const comp = db
        .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = 'Widget'`)
        .get(sessionId) as { component_id: string };

      applyToolCalls(
        db,
        sessionId,
        comp.component_id,
        'Widget',
        [
          { tool: 'classify_prop', prop: 'title', cdf_type: 'string', cdf_category: 'content' },
          { tool: 'exclude_prop', prop: 'internalRef', reason: 'internal implementation detail' },
        ],
        [],
      );

      backfillUnclassifiedProps(db, sessionId);

      const props = db
        .prepare(`SELECT name, cdf_type FROM raw_props WHERE session_id = ? AND component_id = ?`)
        .all(sessionId, comp.component_id) as Array<{ name: string; cdf_type: string | null }>;

      const titleProp = props.find((p) => p.name === 'title');
      const refProp = props.find((p) => p.name === 'internalRef');

      expect(titleProp?.cdf_type).toBe('string');
      expect(refProp?.cdf_type).toBe('excluded');

      const loaded = loadCDFComponents(db, sessionId);
      expect(loaded).toHaveLength(1);
      expect(Object.keys(loaded[0]!.entry.$properties)).toContain('title');
      expect(Object.keys(loaded[0]!.entry.$properties)).not.toContain('internalRef');
      db.close();
    });
  });
});

describe('generation cache', () => {
  it('computeComponentInputHash produces stable hashes for identical input', () => {
    const component = {
      component_id: 'abc123',
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react' as const,
      props: [
        { name: 'label', type: 'string', required: true },
        { name: 'variant', type: "'primary' | 'secondary'", required: false, allowedValues: ['primary', 'secondary'] },
      ],
      slots: [{ name: 'icon', isDefault: false, description: 'Optional icon' }],
    };
    const hash1 = computeComponentInputHash(component);
    const hash2 = computeComponentInputHash(component);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('computeComponentInputHash produces different hashes for different input', () => {
    const base = {
      component_id: 'abc123',
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    };
    const modified = { ...base, props: [{ name: 'title', type: 'string', required: true }] };
    expect(computeComponentInputHash(base)).not.toBe(computeComponentInputHash(modified));
  });

  it('computeComponentInputHash ignores LLM-mutated fields (description, required, defaultValue, allowedValues, tokenReference)', () => {
    const base = {
      component_id: 'abc123',
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: false }],
      slots: [{ name: 'icon', isDefault: false }],
    };
    const enrichedByLLM = {
      ...base,
      props: [
        {
          name: 'label',
          type: 'string',
          required: true,
          description: 'LLM-written description',
          defaultValue: 'Submit',
          allowedValues: ['Submit', 'Cancel'],
          tokenReference: 'tokens.label',
        },
      ],
      slots: [
        {
          name: 'icon',
          isDefault: false,
          description: 'LLM-written slot description',
        },
      ],
    };
    expect(computeComponentInputHash(base)).toBe(computeComponentInputHash(enrichedByLLM));
  });

  it('computeComponentInputHash includes slot composition edges (allowedComponents) so composite and atomic runs never collide', () => {
    const atomic = {
      component_id: 'abc123',
      name: 'Card',
      source: 'src/Card.tsx',
      framework: 'react' as const,
      props: [{ name: 'title', type: 'string', required: true }],
      slots: [{ name: 'children', isDefault: true }],
    };
    const composite = {
      ...atomic,
      slots: [{ name: 'children', isDefault: true, allowedComponents: ['Button', 'Icon'] }],
    };
    expect(computeComponentInputHash(atomic)).not.toBe(computeComponentInputHash(composite));

    const differentEdges = {
      ...atomic,
      slots: [{ name: 'children', isDefault: true, allowedComponents: ['Button'] }],
    };
    expect(computeComponentInputHash(composite)).not.toBe(computeComponentInputHash(differentEdges));

    const sameEdges = {
      ...atomic,
      slots: [{ name: 'children', isDefault: true, allowedComponents: ['Button', 'Icon'] }],
    };
    expect(computeComponentInputHash(composite)).toBe(computeComponentInputHash(sameEdges));
  });

  it('computeComponentInputHash changes when extractor-stable fields change', () => {
    const base = {
      component_id: 'abc123',
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [{ name: 'icon', isDefault: false }],
    };
    const propTypeChanged = { ...base, props: [{ name: 'label', type: 'number', required: true }] };
    expect(computeComponentInputHash(base)).not.toBe(computeComponentInputHash(propTypeChanged));

    const slotNameChanged = { ...base, slots: [{ name: 'header', isDefault: false }] };
    expect(computeComponentInputHash(base)).not.toBe(computeComponentInputHash(slotNameChanged));

    const slotIsDefaultChanged = { ...base, slots: [{ name: 'icon', isDefault: true }] };
    expect(computeComponentInputHash(base)).not.toBe(computeComponentInputHash(slotIsDefaultChanged));

    const sourceChanged = { ...base, source: 'src/Other.tsx' };
    expect(computeComponentInputHash(base)).not.toBe(computeComponentInputHash(sourceChanged));
  });

  it('computeTokenInputHash is stable and trims whitespace', () => {
    const hash1 = computeTokenInputHash('{ "color": "red" }');
    const hash2 = computeTokenInputHash('{ "color": "red" }  \n');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('storeCache + lookupCache round-trips correctly', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'import' });

      storeCache(db, 'hash123', 'component', 'Button', sessionId, false);
      const entry = lookupCache(db, 'hash123', 'component', 'Button');

      expect(entry).not.toBeNull();
      expect(entry!.inputHash).toBe('hash123');
      expect(entry!.entityType).toBe('component');
      expect(entry!.entityId).toBe('Button');
      expect(entry!.sourceSessionId).toBe(sessionId);
      expect(entry!.humanEdited).toBe(false);
      db.close();
    });
  });

  it('lookupCache returns null on cache miss', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      getOrCreateSession(db, 'new', undefined, { command: 'import' });
      const entry = lookupCache(db, 'nonexistent', 'component', 'Foo');
      expect(entry).toBeNull();
      db.close();
    });
  });

  it('storeCache preserves humanEdited=true on re-store', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: session1 } = getOrCreateSession(db, 'new', undefined, { command: 'import' });
      const { sessionId: session2 } = getOrCreateSession(db, 'new', undefined, { command: 'import' });

      storeCache(db, 'hash1', 'component', 'Button', session1, false);
      markCacheHumanEdited(db, 'component', 'Button');

      storeCache(db, 'hash1', 'component', 'Button', session2, false);

      const entry = lookupCache(db, 'hash1', 'component', 'Button');
      expect(entry!.humanEdited).toBe(true);
      expect(entry!.sourceSessionId).toBe(session2);
      db.close();
    });
  });

  it('lookupCacheByEntity returns the entry after an update', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: session1 } = getOrCreateSession(db, 'new', undefined, { command: 'import' });
      const { sessionId: session2 } = getOrCreateSession(db, 'new', undefined, { command: 'import' });

      storeCache(db, 'hash-v1', 'component', 'Button', session1, false);

      storeCache(db, 'hash-v1', 'component', 'Button', session2, false);

      const entry = lookupCacheByEntity(db, 'component', 'Button');
      expect(entry).not.toBeNull();
      expect(entry!.inputHash).toBe('hash-v1');
      expect(entry!.sourceSessionId).toBe(session2);
      db.close();
    });
  });

  it('copyComponentFromCache copies all props, slots, and allowed values', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: srcSession } = getOrCreateSession(db, 'new', undefined, { command: 'import' });

      const raw: RawComponentDefinition[] = [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [
            { name: 'title', type: 'string', required: true },
            { name: 'variant', type: "'flat' | 'raised'", required: false, allowedValues: ['flat', 'raised'] },
          ],
          slots: [
            { name: 'content', isDefault: true, description: 'Main content', allowedComponents: ['Text', 'Image'] },
          ],
        },
      ];
      storeRawComponents(db, srcSession, raw);
      storeCDFComponents(db, srcSession, [
        {
          key: 'Card',
          entry: {
            $type: 'component',
            $description: 'A card',
            $properties: {
              title: { $type: 'string', $category: 'content', $required: true },
              variant: { $type: 'enum', $category: 'design', $values: ['flat', 'raised'] },
            },
            $slots: {
              content: { $description: 'Main content', $required: true, $allowedComponents: ['Text', 'Image'] },
            },
          },
        },
      ]);

      const { sessionId: tgtSession } = getOrCreateSession(db, 'new', undefined, { command: 'import' });
      storeRawComponents(db, tgtSession, raw);

      const componentId = (
        db
          .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = 'Card'`)
          .get(srcSession) as { component_id: string }
      ).component_id;

      copyComponentFromCache(db, srcSession, tgtSession, componentId);

      const loaded = loadCDFComponents(db, tgtSession);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.entry.$properties['title']?.$type).toBe('string');
      expect(loaded[0]!.entry.$properties['variant']?.$values).toEqual(['flat', 'raised']);
      expect(loaded[0]!.entry.$slots?.['content']?.$allowedComponents).toEqual(['Text', 'Image']);
      db.close();
    });
  });

  it('copyTokensFromCache copies all tokens and groups', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: srcSession } = getOrCreateSession(db, 'new', undefined, { command: 'import' });

      const tokens: DTCGTokenEntry[] = [
        { path: 'color.primary', $type: 'color', $value: '#ff0000' },
        { path: 'spacing.sm', $type: 'dimension', $value: '8px' },
      ];
      const groups: DTCGTokenGroup[] = [{ path: 'color', $description: 'Brand colors', tokenIds: [] }];
      storeDTCGTokens(db, srcSession, groups, tokens);

      const { sessionId: tgtSession } = getOrCreateSession(db, 'new', undefined, { command: 'import' });
      copyTokensFromCache(db, srcSession, tgtSession);

      const loaded = loadDTCGTokens(db, tgtSession);
      expect(loaded.tokens).toHaveLength(2);
      expect(loaded.tokens[0]?.path).toBe('color.primary');
      expect(loaded.groups).toHaveLength(1);
      expect(loaded.groups[0]?.path).toBe('color');
      expect(loaded.groups[0]?.$description).toBe('Brand colors');
      db.close();
    });
  });

  it('migrates generation_cache to allow entity_type "token_mapping" on pre-existing databases, preserving rows', async () => {
    await withTempDb((dbPath) => {
      const initial = openPipelineDb(dbPath);
      initial.exec(`
        DROP TABLE generation_cache;
        CREATE TABLE generation_cache (
          input_hash        TEXT NOT NULL,
          entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set')),
          entity_id         TEXT NOT NULL,
          source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          human_edited      INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          prompt_hash       TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (input_hash, prompt_hash, entity_type, entity_id)
        );
      `);
      const { sessionId } = getOrCreateSession(initial, 'new', undefined, { command: 'analyze extract' });
      storeCache(initial, 'hash-a', 'component', 'comp-1', sessionId, false, 'prompt-a');
      initial.close();

      const migrated = openPipelineDb(dbPath);
      const rows = migrated.prepare('SELECT entity_type, entity_id FROM generation_cache').all() as Array<{
        entity_type: string;
        entity_id: string;
      }>;
      expect(rows).toEqual([{ entity_type: 'component', entity_id: 'comp-1' }]);

      expect(() =>
        storeCache(migrated, 'hash-b', 'token_mapping', '__map_tokens__', sessionId, false, 'prompt-b'),
      ).not.toThrow();
      expect(lookupCache(migrated, 'hash-b', 'token_mapping', '__map_tokens__', 'prompt-b')?.entityType).toBe(
        'token_mapping',
      );
      migrated.close();
    });
  });

  it('computeMapTokensInputHash is stable for identical design-token props and tokens, and changes when either changes', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'bgColor', type: 'string', required: false }],
          slots: [],
        },
      ]);
      storeCDFComponents(db, sessionId, [
        {
          key: 'Card',
          entry: {
            $type: 'component',
            $properties: { bgColor: { $type: 'token', $category: 'design', '$token.kind': 'color' } },
          },
        },
      ]);
      storeDTCGTokens(db, sessionId, [], [{ path: 'colors.brand.primary', $type: 'color', $value: '#00f' }]);

      const hash1 = computeMapTokensInputHash(db, sessionId);
      const hash2 = computeMapTokensInputHash(db, sessionId);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);

      storeDTCGTokens(
        db,
        sessionId,
        [],
        [
          { path: 'colors.brand.primary', $type: 'color', $value: '#00f' },
          { path: 'colors.brand.secondary', $type: 'color', $value: '#0f0' },
        ],
      );
      expect(computeMapTokensInputHash(db, sessionId)).not.toBe(hash1);
      db.close();
    });
  });

  it('countMappableTokenProps and countRawTokens report zero on a session with none, and the real counts otherwise', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [
            { name: 'bgColor', type: 'string', required: false },
            { name: 'label', type: 'string', required: true },
          ],
          slots: [],
        },
      ]);
      expect(countMappableTokenProps(db, sessionId)).toBe(0);
      expect(countRawTokens(db, sessionId)).toBe(0);

      storeCDFComponents(db, sessionId, [
        {
          key: 'Card',
          entry: {
            $type: 'component',
            $properties: {
              bgColor: { $type: 'token', $category: 'design', '$token.kind': 'color' },
              label: { $type: 'string', $category: 'content' },
            },
          },
        },
      ]);
      storeDTCGTokens(db, sessionId, [], [{ path: 'colors.brand.primary', $type: 'color', $value: '#00f' }]);
      expect(countMappableTokenProps(db, sessionId)).toBe(1);
      expect(countRawTokens(db, sessionId)).toBe(1);
      db.close();
    });
  });

  it('loadComponentSourceRefs returns generated components with their source path, falling back to source, and null content when the file is unreadable', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        { name: 'Card', source: 'src/Card.tsx', framework: 'react', props: [], slots: [] },
      ]);
      storeCDFComponents(db, sessionId, [{ key: 'Card', entry: { $type: 'component', $properties: {} } }]);
      expect(await loadComponentSourceRefs(db, sessionId)).toEqual([
        { component: 'Card', sourcePath: 'src/Card.tsx', content: null },
      ]);
      db.close();
    });
  });

  it('loadComponentSourceRefs inlines real file content when the source file exists on disk', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const componentPath = join(dir, 'Card.tsx');
      await writeFile(componentPath, 'export const Card = () => null;');

      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        { name: 'Card', source: componentPath, framework: 'react', props: [], slots: [] },
      ]);
      storeCDFComponents(db, sessionId, [{ key: 'Card', entry: { $type: 'component', $properties: {} } }]);
      expect(await loadComponentSourceRefs(db, sessionId)).toEqual([
        { component: 'Card', sourcePath: componentPath, content: 'export const Card = () => null;' },
      ]);
      db.close();
    });
  });

  it('loadComponentSourceRefs truncates content past the size cap', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const componentPath = join(dir, 'Big.tsx');
      await writeFile(componentPath, 'x'.repeat(9_000));

      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        { name: 'Big', source: componentPath, framework: 'react', props: [], slots: [] },
      ]);
      storeCDFComponents(db, sessionId, [{ key: 'Big', entry: { $type: 'component', $properties: {} } }]);
      const [ref] = await loadComponentSourceRefs(db, sessionId);
      expect(ref.content?.endsWith('/* truncated */')).toBe(true);
      expect(ref.content?.length).toBe(8_000 + '\n/* truncated */'.length);
      db.close();
    });
  });

  it('loadComponentSourceRefs inlines the content of files the source file relatively imports', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const componentPath = join(dir, 'Avatar.tsx');
      const stylesPath = join(dir, 'Avatar.styles.ts');
      const utilsPath = join(dir, 'utils.ts');
      await writeFile(
        componentPath,
        `import { getAvatarStyles } from './Avatar.styles';\nimport { type ColorVariant } from './utils';\nimport { unresolvable } from '@contentful/f36-core';\n`,
      );
      await writeFile(stylesPath, 'export const getAvatarStyles = () => ({});');
      await writeFile(utilsPath, 'export const avatarColorMap = { primary: "blue500" };');

      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        { name: 'Avatar', source: componentPath, framework: 'react', props: [], slots: [] },
      ]);
      storeCDFComponents(db, sessionId, [{ key: 'Avatar', entry: { $type: 'component', $properties: {} } }]);

      const [ref] = await loadComponentSourceRefs(db, sessionId);
      expect(ref.siblingFiles).toEqual(
        expect.arrayContaining([
          { path: stylesPath, content: 'export const getAvatarStyles = () => ({});' },
          { path: utilsPath, content: 'export const avatarColorMap = { primary: "blue500" };' },
        ]),
      );
      expect(ref.siblingFiles).toHaveLength(2);
      db.close();
    });
  });

  it('loadComponentSourceRefs omits siblingFiles when the source file has no relative imports', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const componentPath = join(dir, 'Card.tsx');
      await writeFile(componentPath, "import { css } from '@emotion/css';\nexport const Card = () => null;");

      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        { name: 'Card', source: componentPath, framework: 'react', props: [], slots: [] },
      ]);
      storeCDFComponents(db, sessionId, [{ key: 'Card', entry: { $type: 'component', $properties: {} } }]);

      const [ref] = await loadComponentSourceRefs(db, sessionId);
      expect(ref.siblingFiles).toBeUndefined();
      db.close();
    });
  });

  it('loadComponentSourceRef inlines a sibling file for a single component without any DB/session setup', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const componentPath = join(dir, 'Avatar.tsx');
      const utilsPath = join(dir, 'utils.ts');
      await writeFile(componentPath, `import { avatarColorMap } from './utils';\n`);
      await writeFile(utilsPath, 'export const avatarColorMap = { primary: "blue500" };');

      const ref = await loadComponentSourceRef('Avatar', componentPath);
      expect(ref).toEqual({
        component: 'Avatar',
        sourcePath: componentPath,
        content: `import { avatarColorMap } from './utils';\n`,
        siblingFiles: [{ path: utilsPath, content: 'export const avatarColorMap = { primary: "blue500" };' }],
      });
    });
  });

  // A styles module's first 1,200 characters are imports and constants; the
  // line that decides enum-versus-token for a prop is almost never there.
  it('loadComponentSourceRef windows a sibling excerpt around the prop uses instead of taking the head of the file', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const componentPath = join(dir, 'Box.tsx');
      const stylesPath = join(dir, 'Box.styles.ts');
      await writeFile(componentPath, `import { StyledBox } from './Box.styles';\nexport const Box = ({ children, ...rest }: Props) => <StyledBox {...rest}>{children}</StyledBox>;\n`);
      const filler = (prefix: string) => Array.from({ length: 80 }, (_, i) => `export const ${prefix}${i} = ${i};`).join('\n');
      await writeFile(stylesPath, `${filler('before')}\nexport const StyledBox = styled.div\`padding: \${(p) => p.padding};\`;\n${filler('after')}\n`);

      const ref = await loadComponentSourceRef('Box', componentPath, ['padding', 'children']);
      expect(ref.siblingFiles).toHaveLength(1);
      expect(ref.siblingFiles?.[0].content).toContain('padding: ${(p) => p.padding};');
      expect(ref.siblingFiles?.[0].content).not.toContain('before0 = 0');
      expect(ref.siblingFiles?.[0].content.length).toBeLessThanOrEqual(1_200 + '\n/* truncated */'.length);
      expect(ref.usesNotShown).toBeUndefined();
    });
  });

  it('loadComponentSourceRef reports the props whose uses were cut by the sibling budget', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const componentPath = join(dir, 'Box.tsx');
      const stylesPath = join(dir, 'Box.styles.ts');
      await writeFile(componentPath, `import { StyledBox } from './Box.styles';\n`);
      const filler = (prefix: string) => Array.from({ length: 80 }, (_, i) => `export const ${prefix}${i} = ${i};`).join('\n');
      // Two uses far apart, each with a wide window: the second cannot fit in 1,200 chars.
      const bigLine = (name: string) => `export const ${name}Style = css\`\${(p) => p.${name}}; /* ${'x'.repeat(900)} */\`;`;
      await writeFile(stylesPath, `${filler('a')}\n${bigLine('padding')}\n${filler('b')}\n${bigLine('margin')}\n${filler('c')}\n`);

      const ref = await loadComponentSourceRef('Box', componentPath, ['padding', 'margin']);
      // Later windows are kept in preference to earlier ones, so the margin use
      // survives and the padding use is the one reported as cut.
      expect(ref.siblingFiles?.[0].content).toContain('p.margin');
      expect(ref.siblingFiles?.[0].content).not.toContain('p.padding');
      expect(ref.usesNotShown).toEqual(['padding']);
    });
  });

  it('loadComponentSourceRef inlines a second-hop sibling reached through a first-hop sibling component', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const tagPath = join(dir, 'Tag.tsx');
      const pillNextPath = join(dir, 'PillNext.tsx');
      const pillNextStylesPath = join(dir, 'PillNext.styles.ts');
      await writeFile(tagPath, `import { PillNext } from './PillNext';\n`);
      await writeFile(pillNextPath, `import { variantStyles } from './PillNext.styles';\n`);
      await writeFile(
        pillNextStylesPath,
        'export const variantStyles = { neutral: tokens.gray300, positive: tokens.green300 };',
      );

      const ref = await loadComponentSourceRef('Tag', tagPath);
      expect(ref.siblingFiles).toEqual(
        expect.arrayContaining([
          { path: pillNextPath, content: `import { variantStyles } from './PillNext.styles';\n` },
          {
            path: pillNextStylesPath,
            content: 'export const variantStyles = { neutral: tokens.gray300, positive: tokens.green300 };',
          },
        ]),
      );
      expect(ref.siblingFiles).toHaveLength(2);
    });
  });

  it('loadComponentSourceRef does not hang or duplicate a file when siblings import each other in a cycle', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const aPath = join(dir, 'A.tsx');
      const bPath = join(dir, 'B.ts');
      await writeFile(aPath, `import { b } from './B';\n`);
      await writeFile(bPath, `import { a } from './A';\nexport const b = 1;\n`);

      const ref = await loadComponentSourceRef('A', aPath);
      expect(ref.siblingFiles).toEqual([{ path: bPath, content: `import { a } from './A';\nexport const b = 1;\n` }]);
    });
  });

  it('loadComponentSourceRef caps inlined siblings at 5 and reports the rest as truncated when discovery spans two hops', async () => {
    await withTempDb(async (dbPath) => {
      const dir = dirname(dbPath);
      const rootPath = join(dir, 'Root.tsx');
      const hop1Paths = ['H1a', 'H1b', 'H1c'].map((name) => join(dir, `${name}.ts`));
      const hop2Paths = ['H2a', 'H2b', 'H2c'].map((name) => join(dir, `${name}.ts`));

      await writeFile(
        rootPath,
        hop1Paths.map((_, i) => `import { x${i} } from './H1${['a', 'b', 'c'][i]}';\n`).join(''),
      );
      for (let i = 0; i < hop1Paths.length; i++) {
        await writeFile(
          hop1Paths[i],
          `import { y${i} } from './H2${['a', 'b', 'c'][i]}';\nexport const x${i} = ${i};\n`,
        );
      }
      for (let i = 0; i < hop2Paths.length; i++) {
        await writeFile(hop2Paths[i], `export const y${i} = ${i};\n`);
      }

      const ref = await loadComponentSourceRef('Root', rootPath);
      expect(ref.siblingFiles).toHaveLength(5);
      expect(ref.truncatedSiblingCount).toBe(1);
    });
  });

  it('copyMapTokensFromCache copies matching-by-name components and skips props absent in the target session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: sourceId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sourceId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'bgColor', type: 'string', required: false }],
          slots: [],
        },
      ]);
      const sourceComponentId = loadRawComponents(db, sourceId)[0].component_id;
      replaceRawPropTokenPaths(
        db,
        sourceId,
        sourceComponentId,
        'bgColor',
        'set',
        ['colors.surface.default', 'colors.surface.raised'],
        'agent',
      );
      replaceRawPropTokenPaths(
        db,
        sourceId,
        sourceComponentId,
        'bgColor',
        'allowed',
        ['colors.surface.default'],
        'agent',
      );

      const { sessionId: targetId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, targetId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'bgColor', type: 'string', required: false }],
          slots: [],
        },
      ]);

      const copied = copyMapTokensFromCache(db, sourceId, targetId);
      expect(copied).toBe(1);

      const targetComponentId = loadRawComponents(db, targetId)[0].component_id;
      const groups = loadRawPropTokenPaths(db, targetId);
      // loadRawPropTokenPaths orders groups by (component_id, prop_name, kind, position); 'allowed'
      // sorts before 'set' alphabetically, so that's the order groups come back in here too.
      expect(groups).toEqual([
        { componentId: targetComponentId, propName: 'bgColor', kind: 'allowed', paths: ['colors.surface.default'] },
        {
          componentId: targetComponentId,
          propName: 'bgColor',
          kind: 'set',
          paths: ['colors.surface.default', 'colors.surface.raised'],
        },
      ]);
      db.close();
    });
  });
});

describe('renameEmptySlots', () => {
  function seedComponentWithSlots(
    dbPath: string,
    slots: Array<{ name: string; isDefault: boolean }>,
  ): { sessionId: string; componentId: string } {
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: '/tmp',
      outDir: '/tmp',
    });
    storeRawComponents(db, sessionId, [
      {
        name: 'TestComponent',
        source: '/tmp/TestComponent.tsx',
        framework: 'react',
        props: [],
        slots,
      },
    ]);
    const row = db.prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`).get(sessionId) as {
      component_id: string;
    };
    db.close();
    return { sessionId, componentId: row.component_id };
  }

  it('returns empty renames and no warnings when all slots have names', async () => {
    await withTempDb((dbPath) => {
      const { sessionId, componentId } = seedComponentWithSlots(dbPath, [{ name: 'children', isDefault: true }]);
      const db = openPipelineDb(dbPath);
      const result = renameEmptySlots(db, sessionId, componentId, 'TestComponent', 1);
      db.close();
      expect(result.renames).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  it('renames a single empty-named slot to "children"', async () => {
    await withTempDb((dbPath) => {
      const { sessionId, componentId } = seedComponentWithSlots(dbPath, [{ name: '', isDefault: false }]);
      const db = openPipelineDb(dbPath);
      const result = renameEmptySlots(db, sessionId, componentId, 'TestComponent', 1);
      db.close();
      expect(result.renames).toHaveLength(1);
      expect(result.renames[0]).toEqual({ oldName: '', newName: 'children' });
      expect(result.warnings[0]).toContain('"children"');
      const db2 = openPipelineDb(dbPath);
      const slots = loadRawComponents(db2, sessionId)[0]!.slots;
      db2.close();
      expect(slots.map((s) => s.name)).toEqual(['children']);
    });
  });

  it('uses positional name when the component has multiple total slots (one named, one empty)', async () => {
    await withTempDb((dbPath) => {
      const { sessionId, componentId } = seedComponentWithSlots(dbPath, [
        { name: 'header', isDefault: false },
        { name: '', isDefault: false },
      ]);
      const db = openPipelineDb(dbPath);
      const result = renameEmptySlots(db, sessionId, componentId, 'TestComponent', 2);
      db.close();
      expect(result.renames).toHaveLength(1);
      expect(result.renames[0]!.newName).toBe('slot_1');
      const db2 = openPipelineDb(dbPath);
      const slots = loadRawComponents(db2, sessionId)[0]!.slots;
      db2.close();
      expect(slots.map((s) => s.name).sort()).toEqual(['header', 'slot_1']);
    });
  });

  it('is idempotent — calling twice on the same DB state is a no-op', async () => {
    await withTempDb((dbPath) => {
      const { sessionId, componentId } = seedComponentWithSlots(dbPath, [{ name: '', isDefault: false }]);
      const db = openPipelineDb(dbPath);
      const first = renameEmptySlots(db, sessionId, componentId, 'TestComponent', 1);
      const second = renameEmptySlots(db, sessionId, componentId, 'TestComponent', 1);
      db.close();
      expect(first.renames).toHaveLength(1);
      expect(second.renames).toHaveLength(0);
      expect(second.warnings).toHaveLength(0);
    });
  });

  it('re-extract restores name="" so a subsequent rename re-fires', async () => {
    await withTempDb((dbPath) => {
      const { sessionId, componentId } = seedComponentWithSlots(dbPath, [{ name: '', isDefault: false }]);

      const db = openPipelineDb(dbPath);
      const first = renameEmptySlots(db, sessionId, componentId, 'TestComponent', 1);
      expect(first.renames).toHaveLength(1);
      db.close();

      const db2 = openPipelineDb(dbPath);
      storeRawComponents(db2, sessionId, [
        {
          name: 'TestComponent',
          source: '/tmp/TestComponent.tsx',
          framework: 'react',
          props: [],
          slots: [{ name: '', isDefault: false }],
        },
      ]);
      const newComponentId = (
        db2.prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`).get(sessionId) as {
          component_id: string;
        }
      ).component_id;
      const second = renameEmptySlots(db2, sessionId, newComponentId, 'TestComponent', 1);
      db2.close();
      expect(second.renames).toHaveLength(1);
      expect(second.renames[0]!.newName).toBe('children');
    });
  });

  it('skips whitespace-only slot names the same way as empty', async () => {
    await withTempDb((dbPath) => {
      const { sessionId, componentId } = seedComponentWithSlots(dbPath, [{ name: '   ', isDefault: false }]);
      const db = openPipelineDb(dbPath);
      const result = renameEmptySlots(db, sessionId, componentId, 'TestComponent', 1);
      db.close();
      expect(result.renames).toHaveLength(1);
      expect(result.renames[0]!.newName).toBe('children');
    });
  });
});

describe('loadCDFComponents — empty-key sanitization (Option D / hallucination insurance)', () => {
  it('drops empty-named slots from the CDF entry so buildManifest never sees them', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'PageLink',
          source: 'src/PageLink.tsx',
          framework: 'react',
          props: [{ name: 'href', type: 'string', required: true, category: 'content' }],
          slots: [
            { name: 'children', isDefault: true, description: 'Body content' },
            { name: '', isDefault: false, description: 'Hallucinated empty' },
          ],
        },
      ]);
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);
      db.prepare(`UPDATE raw_props SET cdf_type = 'string', cdf_category = 'content' WHERE session_id = ?`).run(
        sessionId,
      );

      const loaded = loadCDFComponents(db, sessionId);
      db.close();
      expect(loaded).toHaveLength(1);
      const slotKeys = Object.keys(loaded[0]!.entry.$slots ?? {});
      expect(slotKeys).toEqual(['children']);
      expect(slotKeys).not.toContain('');
    });
  });

  it('end-to-end: rename → generate → loadCDFComponents → buildManifest produces no empty keys', async () => {
    const { buildManifest } = await import('@contentful/experience-design-system-types');
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'PageLink',
          source: 'src/PageLink.tsx',
          framework: 'react',
          props: [{ name: 'href', type: 'string', required: true, category: 'content' }],
          slots: [{ name: '', isDefault: true }],
        },
      ]);
      const componentId = (
        db.prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`).get(sessionId) as {
          component_id: string;
        }
      ).component_id;

      const renameResult = renameEmptySlots(db, sessionId, componentId, 'PageLink', 1);
      expect(renameResult.renames).toEqual([{ oldName: '', newName: 'children' }]);

      applyToolCalls(
        db,
        sessionId,
        componentId,
        'PageLink',
        [
          {
            tool: 'classify_prop',
            prop: 'href',
            cdf_type: 'string',
            cdf_category: 'content',
          },
          {
            tool: 'classify_slot',
            slot: 'children',
            description: 'Body',
          },
        ],
        [],
      );
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);

      const components = loadCDFComponents(db, sessionId);
      db.close();

      const manifest = buildManifest(components, []);
      const slotKeys = Object.keys(
        (manifest.componentsManifest?.['PageLink'] as { $slots?: Record<string, unknown> }).$slots ?? {},
      );
      expect(slotKeys).toEqual(['children']);
      expect(slotKeys).not.toContain('');
    });
  });

  it('drops empty-named props from the CDF entry', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [
            { name: 'title', type: 'string', required: true, category: 'content' },
            { name: '', type: 'string', required: false, category: 'content' },
          ],
          slots: [],
        },
      ]);
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);
      db.prepare(`UPDATE raw_props SET cdf_type = 'string', cdf_category = 'content' WHERE session_id = ?`).run(
        sessionId,
      );

      const loaded = loadCDFComponents(db, sessionId);
      db.close();
      expect(loaded).toHaveLength(1);
      const propKeys = Object.keys(loaded[0]!.entry.$properties);
      expect(propKeys).toEqual(['title']);
      expect(propKeys).not.toContain('');
    });
  });
});

describe('loadCDFComponents — zero-classified-prop components (INTEG-4257)', () => {
  it('surfaces components with zero classified props instead of silently filtering them', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Button',
          source: 'src/Button.tsx',
          framework: 'react',
          props: [{ name: 'label', type: 'string', required: true, category: 'content' }],
          slots: [],
        },
        {
          name: 'OpaqueWidget',
          source: 'src/OpaqueWidget.tsx',
          framework: 'react',
          props: [
            { name: 'foo', type: 'unknown', required: false },
            { name: 'bar', type: 'unknown', required: false },
          ],
          slots: [],
        },
      ]);
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);
      db.prepare(
        `UPDATE raw_props SET cdf_type = 'string', cdf_category = 'content'
         WHERE session_id = ? AND component_id IN (
           SELECT component_id FROM raw_components WHERE session_id = ? AND name = 'Button'
         )`,
      ).run(sessionId, sessionId);

      const loaded = loadCDFComponents(db, sessionId);
      db.close();

      expect(loaded).toHaveLength(2);
      const button = loaded.find((c) => c.key === 'Button');
      const widget = loaded.find((c) => c.key === 'OpaqueWidget');
      expect(button).toBeDefined();
      expect(Object.keys(button!.entry.$properties)).toEqual(['label']);
      expect(widget).toBeDefined();
      expect(Object.keys(widget!.entry.$properties)).toHaveLength(0);
      expect(widget!.entry.$type).toBe('component');
      expect(widget!.entry.$properties).toEqual({});
    });
  });
});
