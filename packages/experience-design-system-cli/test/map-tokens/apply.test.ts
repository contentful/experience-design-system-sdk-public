import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
  storeCDFComponents,
  storeDTCGTokens,
  loadRawPropTokenPaths,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';
import { applyMapTokenPropCalls } from '../../src/map-tokens/apply.js';
import type { MapTokenPropCall } from '@contentful/experience-design-system-generation';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-db-map-tokens-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  await run(dbPath);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const RAW: RawComponentDefinition[] = [
  {
    name: 'Card',
    source: 'src/Card.tsx',
    framework: 'react',
    props: [
      { name: 'bgColor', type: 'string', required: false, category: 'design' },
      { name: 'label', type: 'string', required: true, category: 'content' },
    ],
    slots: [],
  },
];

/** Seeds a Card component with bgColor classified as a design-category token prop. */
function seedSession(db: Parameters<typeof storeRawComponents>[0], sessionId: string): void {
  storeRawComponents(db, sessionId, RAW);
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
  storeDTCGTokens(
    db,
    sessionId,
    [],
    [
      { path: 'colors.surface.default', $type: 'color', $value: '#fff' },
      { path: 'colors.surface.raised', $type: 'color', $value: '#eee' },
      { path: 'colors.brand.primary', $type: 'color', $value: '#00f' },
    ],
  );
}

describe('applyMapTokenPropCalls', () => {
  it('persists token_sets for a valid design-token prop', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      const calls: MapTokenPropCall[] = [
        {
          tool: 'map_token_prop',
          component: 'Card',
          prop: 'bgColor',
          token_sets: ['colors.surface.default', 'colors.surface.raised'],
        },
      ];
      const result = applyMapTokenPropCalls(db, sessionId, calls, []);

      expect(result).toEqual({ applied: 1, warnings: [] });
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        {
          componentId,
          propName: 'bgColor',
          kind: 'set',
          paths: ['colors.surface.default', 'colors.surface.raised'],
        },
      ]);
      db.close();
    });
  });

  it('persists token_allowed alongside token_sets', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      const calls: MapTokenPropCall[] = [
        {
          tool: 'map_token_prop',
          component: 'Card',
          prop: 'bgColor',
          token_sets: ['colors.surface.default', 'colors.surface.raised'],
          token_allowed: ['colors.surface.default'],
        },
      ];
      applyMapTokenPropCalls(db, sessionId, calls, []);

      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'bgColor', kind: 'allowed', paths: ['colors.surface.default'] },
        { componentId, propName: 'bgColor', kind: 'set', paths: ['colors.surface.default', 'colors.surface.raised'] },
      ]);
      db.close();
    });
  });

  it('persists an empty token_allowed as an explicit, distinguishable empty set', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      applyMapTokenPropCalls(
        db,
        sessionId,
        [
          {
            tool: 'map_token_prop',
            component: 'Card',
            prop: 'bgColor',
            token_sets: ['colors.surface.default'],
            token_allowed: [],
          },
        ],
        [],
      );

      const groups = loadRawPropTokenPaths(db, sessionId);
      const allowedGroup = groups.find((g) => g.kind === 'allowed');
      expect(allowedGroup?.paths).toEqual([]);

      // Omitting token_allowed on a second, different prop leaves no 'allowed' row at all —
      // distinguishing "never assessed" from "assessed and empty".
      applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_sets: ['colors.surface.raised'] }],
        [],
      );
      const groupsAfter = loadRawPropTokenPaths(db, sessionId);
      expect(groupsAfter.find((g) => g.kind === 'allowed')?.paths).toEqual([]);
      db.close();
    });
  });

  it('drops paths not present in raw_tokens with a warning, keeps valid ones', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [
          {
            tool: 'map_token_prop',
            component: 'Card',
            prop: 'bgColor',
            token_sets: ['colors.surface.default', 'colors.hallucinated.path'],
          },
        ],
        [],
      );

      expect(result.applied).toBe(1);
      expect(result.warnings.some((w) => w.includes('colors.hallucinated.path'))).toBe(true);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'bgColor', kind: 'set', paths: ['colors.surface.default'] },
      ]);
      db.close();
    });
  });

  it('skips the call and persists nothing when every token_sets path is unknown', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_sets: ['colors.hallucinated.path'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toMatch(/dropped unknown token path/);
      expect(result.warnings[1]).toMatch(/no valid token_sets remain/);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('rejects a call targeting an unknown component, with a warning', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Nonexistent', prop: 'bgColor', token_sets: ['colors.surface.default'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toMatch(/unknown component/);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('rejects a call targeting an unknown prop, with a warning', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [
          {
            tool: 'map_token_prop',
            component: 'Card',
            prop: 'nonexistentProp',
            token_sets: ['colors.surface.default'],
          },
        ],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toMatch(/unknown prop/);
      db.close();
    });
  });

  it('rejects a call targeting a non-design-category prop, persisting nothing', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'label', token_sets: ['colors.surface.default'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toMatch(/not a design-category token prop/);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('carries forward incoming warnings and continues processing subsequent calls after a rejection', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [
          { tool: 'map_token_prop', component: 'Card', prop: 'label', token_sets: ['colors.surface.default'] },
          {
            tool: 'map_token_prop',
            component: 'Card',
            prop: 'bgColor',
            token_sets: ['colors.surface.default'],
          },
        ],
        ['unparseable line: {bad'],
      );

      expect(result.applied).toBe(1);
      expect(result.warnings[0]).toBe('unparseable line: {bad');
      expect(result.warnings).toHaveLength(2);
      db.close();
    });
  });
});
