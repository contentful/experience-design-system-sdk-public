import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  loadRawComponents,
  replaceRawPropTokenPaths,
  storeDTCGTokens,
  storeCDFComponents,
} from '../../src/session/db.js';
import type { DatabaseSync } from 'node:sqlite';
import { applyMapTokenPropCalls } from '../../src/map-tokens/apply.js';
import type { MapTokenPropCall } from '@contentful/experience-design-system-generation';
import { seedCardSession } from '../helpers/seed-card-session.js';

/** Reads a prop's stored token-allowed paths directly, in position order. */
function readTokenPaths(db: DatabaseSync, sessionId: string, componentId: string, propName: string): string[] {
  return (
    db
      .prepare(
        `SELECT path FROM raw_prop_token_paths
         WHERE session_id = ? AND component_id = ? AND prop_name = ?
         ORDER BY position`,
      )
      .all(sessionId, componentId, propName) as Array<{ path: string }>
  ).map((r) => r.path);
}

/** Counts every stored token-allowed path across the whole session. */
function countAllTokenPaths(db: DatabaseSync, sessionId: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM raw_prop_token_paths WHERE session_id = ?`).get(sessionId) as {
      count: number;
    }
  ).count;
}

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


describe('applyMapTokenPropCalls', () => {
  it('persists token_allowed paths that exist in raw_tokens', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);
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
      expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.surface.default']);
      db.close();
    });
  });

  it("drops a path whose token type does not match the prop's $token.kind", async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;
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
      expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.surface.default']);
      db.close();
    });
  });

  it('skips the call entirely when every path is the wrong token type', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);
      storeDTCGTokens(db, sessionId, [], [{ path: 'spacing.md', $type: 'dimension', $value: '8px' }]);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['spacing.md'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(countAllTokenPaths(db, sessionId)).toBe(0);
      db.close();
    });
  });

  it('drops a path absent from raw_tokens and warns, keeping the valid ones', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);
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
      expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.surface.default']);
      db.close();
    });
  });

  it('rejects a variant name in place of a token path, persisting nothing', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['primary'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings.join('\n')).toContain('no valid token_allowed remain');
      expect(countAllTokenPaths(db, sessionId)).toBe(0);
      db.close();
    });
  });

  it("leaves a reviewer's restriction untouched", async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;
      replaceRawPropTokenPaths(db, sessionId, componentId, 'bgColor', ['colors.brand.primary'], 'review');

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['colors.surface.default'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings.join('\n')).toContain('a reviewer already set this restriction');
      expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.brand.primary']);
      db.close();
    });
  });

  it('a restriction saved through the review editor outranks a later map-tokens run', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;

      // storeCDFComponents is the review editor's write path: a save here is
      // a person's decision, and is recorded as such.
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
                '$token.allowed': ['colors.brand.primary'],
              },
              label: { $type: 'string', $category: 'content' },
            },
          },
        },
      ]);

      const sources = db
        .prepare(`SELECT DISTINCT source FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ?`)
        .all(sessionId, componentId) as Array<{ source: string }>;
      expect(sources).toEqual([{ source: 'review' }]);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['colors.surface.default'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings.join('\n')).toContain('a reviewer already set this restriction');
      expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.brand.primary']);
      db.close();
    });
  });

  it('revises its own previous suggestion on a re-run', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);
      const componentId = loadRawComponents(db, sessionId)[0].component_id;
      replaceRawPropTokenPaths(db, sessionId, componentId, 'bgColor', ['colors.brand.primary'], 'agent');

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['colors.surface.default'] }],
        [],
      );

      expect(result).toEqual({ applied: 1, warnings: [] });
      expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.surface.default']);
      db.close();
    });
  });

  it('records its own writes as agent-sourced, so a later run can revise them', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);

      applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'bgColor', token_allowed: ['colors.surface.default'] }],
        [],
      );

      const sources = db
        .prepare(`SELECT DISTINCT source FROM raw_prop_token_paths WHERE session_id = ?`)
        .all(sessionId) as Array<{ source: string }>;
      expect(sources).toEqual([{ source: 'agent' }]);
      db.close();
    });
  });

  it('rejects a call targeting an unknown component, with a warning', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Nonexistent', prop: 'bgColor', token_allowed: ['colors.surface.default'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toMatch(/unknown component/);
      expect(countAllTokenPaths(db, sessionId)).toBe(0);
      db.close();
    });
  });

  it('rejects a call targeting an unknown prop, with a warning', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);

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
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);

      const result = applyMapTokenPropCalls(
        db,
        sessionId,
        [{ tool: 'map_token_prop', component: 'Card', prop: 'label', token_allowed: ['colors.surface.default'] }],
        [],
      );

      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toMatch(/not a design-category token prop/);
      expect(countAllTokenPaths(db, sessionId)).toBe(0);
      db.close();
    });
  });

  it('carries forward incoming warnings and continues processing subsequent calls after a rejection', async () => {
    await withTempDb((dbPath) => {
      const sessionId = seedCardSession(dbPath);
      const db = openPipelineDb(dbPath);

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
