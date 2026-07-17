import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';
import type {
  CDFComponentEntry,
  DTCGTokenEntry,
  DTCGTokenGroup,
  ComponentTypeSummary,
} from '@contentful/experience-design-system-types';

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

        const componentId = (
          db
            .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
            .get(sessionId, 'CycleA') as { component_id: string } | undefined
        )?.component_id;
        const slotRows = db
          .prepare('SELECT name FROM raw_slots WHERE session_id = ? AND component_id = ?')
          .all(sessionId, componentId) as Array<{ name: string }>;
        expect(slotRows).toHaveLength(0);

        const acRows = db
          .prepare('SELECT allowed_component FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ?')
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

        const componentId = (
          db
            .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
            .get(sessionId, 'Card') as { component_id: string } | undefined
        )?.component_id;
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
