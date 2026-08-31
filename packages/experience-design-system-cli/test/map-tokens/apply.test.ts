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
  replaceRawPropTokenPaths,
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
  it('persists token_allowed paths that exist in raw_tokens', async () => {
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
          token_allowed: ['colors.surface.default'],
        },
      ];
      const result = applyMapTokenPropCalls(db, sessionId, calls, []);

      expect(result).toEqual({ applied: 1, warnings: [] });
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'bgColor', kind: 'allowed', paths: ['colors.surface.default'] },
      ]);
      db.close();
    });
  });

  it("drops a path whose token type does not match the prop's $token.kind", async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);
      // bgColor is $token.kind "color"; spacing.md is a dimension token.
      // storeDTCGTokens replaces the session's token set, so re-state the colours.
      storeDTCGTokens(
        db,
        sessionId,
        [],
        [
          { path: 'colors.surface.default', $type: 'color', $value: '#fff' },
          { path: 'spacing.md', $type: 'dimension', $value: '8px' },
        ],
      );

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [
          {
            tool: 'map_token_prop',
            component: 'Card',
            prop: 'bgColor',
            token_allowed: ['spacing.md', 'colors.surface.default'],
          },
        ],
        [],
      );

      expect(result.applied).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('spacing.md');
      expect(result.warnings[0]).toContain('dimension');
      expect(result.warnings[0]).toContain('color');
      // Only the correctly-typed path is persisted.
      expect(loadRawPropTokenPaths(db, sessionId)[0]?.paths).toEqual(['colors.surface.default']);
      db.close();
    });
  });

  it('skips the call entirely when every path is the wrong token type', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);
      storeDTCGTokens(db, sessionId, [], [{ path: 'spacing.md', $type: 'dimension', $value: '8px' }]);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['spacing.md'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('drops a path absent from raw_tokens and warns, keeping the valid ones', async () => {
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
            token_allowed: ['colors.surface.default', 'colors.ghost.500'],
          },
        ],
        [],
      );

      expect(result.applied).toBe(1);
      expect(result.warnings.join('\n')).toContain("dropped unknown token path 'colors.ghost.500'");
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'bgColor', kind: 'allowed', paths: ['colors.surface.default'] },
      ]);
      db.close();
    });
  });

  it('rejects a variant name in place of a token path, persisting nothing', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['primary'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings.join('\n')).toContain('no valid token_allowed remain');
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('skips a prop that already has a proven binding, leaving it untouched', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;
      replaceRawPropTokenPaths(db, sessionId, componentId, 'bgColor', 'allowed', ['colors.brand.primary']);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['colors.surface.default'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings.join('\n')).toContain('already bound from source evidence');
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        { componentId, propName: 'bgColor', kind: 'allowed', paths: ['colors.brand.primary'] },
      ]);
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
        [{ tool: 'map_token_prop', component: 'Nonexistent', prop: 'bgColor', token_allowed: ['colors.surface.default'] }],
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
            token_allowed: ['colors.surface.default'],
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
        [{ tool: 'map_token_prop', component: 'Card', prop: 'label', token_allowed: ['colors.surface.default'] }],
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
          { tool: 'map_token_prop', component: 'Card', prop: 'label', token_allowed: ['colors.surface.default'] },
          {
            tool: 'map_token_prop',
            component: 'Card',
            prop: 'bgColor',
            token_allowed: ['colors.surface.default'],
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
