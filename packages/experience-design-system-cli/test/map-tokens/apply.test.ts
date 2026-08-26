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

/** Seeds a Card component with bgColor classified as a design-category token prop
 *  whose closed variant list ($values) is ['default', 'raised', 'primary']. */
function seedSession(db: Parameters<typeof storeRawComponents>[0], sessionId: string): void {
  storeRawComponents(db, sessionId, RAW);
  storeCDFComponents(db, sessionId, [
    {
      key: 'Card',
      entry: {
        $type: 'component',
        $properties: {
          bgColor: {
            $type: 'token',
            $category: 'design',
            '$token.kind': 'color',
            $values: ['default', 'raised', 'primary'],
          },
          label: { $type: 'string', $category: 'content' },
        },
      },
    },
  ]);
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
          token_sets: ['default', 'raised'],
        },
      ];
      const result = applyMapTokenPropCalls(db, sessionId, calls, []);

      expect(result).toEqual({ applied: 1, warnings: [] });
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        {
          componentId,
          propName: 'bgColor',
          kind: 'set',
          paths: ['default', 'raised'],
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
          token_sets: ['default', 'raised'],
          token_allowed: ['default'],
        },
      ];
      applyMapTokenPropCalls(db, sessionId, calls, []);

      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'bgColor', kind: 'allowed', paths: ['default'] },
        { componentId, propName: 'bgColor', kind: 'set', paths: ['default', 'raised'] },
      ]);
      db.close();
    });
  });

  it('persists an empty token_allowed the same as an omitted one — both mean unrestricted', async () => {
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
            token_sets: ['default'],
            token_allowed: [],
          },
        ],
        [],
      );

      // An explicit empty token_allowed and an omitted one both mean "unrestricted" — neither
      // writes an 'allowed' row, so there's nothing to distinguish on read-back.
      const groups = loadRawPropTokenPaths(db, sessionId);
      expect(groups.find((g) => g.kind === 'allowed')).toBeUndefined();

      applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_sets: ['raised'] }],
        [],
      );
      const groupsAfter = loadRawPropTokenPaths(db, sessionId);
      expect(groupsAfter.find((g) => g.kind === 'allowed')).toBeUndefined();
      db.close();
    });
  });

  it("drops values not present in the prop's own $values with a warning, keeps valid ones", async () => {
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
            token_sets: ['default', 'hallucinated'],
          },
        ],
        [],
      );

      expect(result.applied).toBe(1);
      expect(result.warnings.some((w) => w.includes('hallucinated'))).toBe(true);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'bgColor', kind: 'set', paths: ['default'] },
      ]);
      db.close();
    });
  });

  it('skips the call and persists nothing when every token_sets value is unknown', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_sets: ['hallucinated'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toMatch(/dropped unknown value/);
      expect(result.warnings[1]).toMatch(/no valid token_sets remain/);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('rejects a call whose token_allowed is not a subset of token_sets, persisting nothing', async () => {
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
            prop: 'bgColor',
            token_sets: ['default'],
            token_allowed: ['primary'],
          },
        ],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings.some((w) => w.includes('token_allowed is not a subset of token_sets'))).toBe(true);
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
        [{ tool: 'map_token_prop', component: 'Nonexistent', prop: 'bgColor', token_sets: ['default'] }],
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
            token_sets: ['default'],
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
        [{ tool: 'map_token_prop', component: 'Card', prop: 'label', token_sets: ['default'] }],
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
          { tool: 'map_token_prop', component: 'Card', prop: 'label', token_sets: ['default'] },
          {
            tool: 'map_token_prop',
            component: 'Card',
            prop: 'bgColor',
            token_sets: ['default'],
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

  it('scopes valid values per prop — a value valid for one prop does not leak into another', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [
            { name: 'bgColor', type: 'string', required: false, category: 'design' },
            { name: 'borderColor', type: 'string', required: false, category: 'design' },
          ],
          slots: [],
        },
      ]);
      storeCDFComponents(db, sessionId, [
        {
          key: 'Card',
          entry: {
            $type: 'component',
            $properties: {
              bgColor: { $type: 'token', $category: 'design', '$token.kind': 'color', $values: ['default'] },
              borderColor: { $type: 'token', $category: 'design', '$token.kind': 'color', $values: ['primary'] },
            },
          },
        },
      ]);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_sets: ['primary'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toMatch(/dropped unknown value 'primary'/);
      db.close();
    });
  });
});
