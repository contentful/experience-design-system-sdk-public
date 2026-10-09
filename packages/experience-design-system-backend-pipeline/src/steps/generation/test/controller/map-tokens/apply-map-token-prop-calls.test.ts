import { describe, expect, it } from 'vitest';
import type { MapTokenPropCall } from '../../../../../agents/types/tool-calls.js';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
} from '../../../../../persistence/src/session/repositories/db.js';
import { applyMapTokenPropCalls } from '../../../src/controller/map-tokens/apply-map-token-prop-calls.js';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';

function seedComponentWithTokenProp(
  db: ReturnType<typeof openPipelineDb>,
  sessionId: string,
  componentName: string,
  propName: string,
  tokenKind: string,
) {
  const comp: RawComponentDefinition = {
    name: componentName,
    source: 'src/x.tsx',
    framework: 'react',
    props: [{ name: propName, type: 'string', required: false }],
    slots: [],
  };
  storeRawComponents(db, sessionId, [comp]);
  const { component_id } = db
    .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
    .get(sessionId, componentName) as { component_id: string };
  db.prepare(
    `UPDATE raw_props SET cdf_type = 'token', cdf_category = 'design', cdf_token_kind = ?
      WHERE session_id = ? AND component_id = ? AND name = ?`,
  ).run(tokenKind, sessionId, component_id, propName);
  return component_id;
}

function seedToken(db: ReturnType<typeof openPipelineDb>, sessionId: string, path: string, type: string) {
  db.prepare(
    `INSERT INTO raw_tokens (session_id, path, type, value)
     VALUES (?, ?, ?, '')`,
  ).run(sessionId, path, type);
}

describe('applyMapTokenPropCalls', () => {
  it('writes allowed token paths for a valid call', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'map tokens' });
      const componentId = seedComponentWithTokenProp(db, sessionId, 'Button', 'color', 'color');
      seedToken(db, sessionId, 'colors.brand.primary', 'color');

      const calls: MapTokenPropCall[] = [
        { tool: 'map_token_prop', component: 'Button', prop: 'color', token_allowed: ['colors.brand.primary'] },
      ];
      const result = applyMapTokenPropCalls(db, sessionId, calls, []);
      expect(result.applied).toBe(1);
      expect(result.warnings).toEqual([]);

      const paths = db
        .prepare(
          `SELECT path FROM raw_prop_token_paths
            WHERE session_id = ? AND component_id = ? AND prop_name = ?
            ORDER BY position`,
        )
        .all(sessionId, componentId, 'color') as Array<{ path: string }>;
      expect(paths.map((p) => p.path)).toEqual(['colors.brand.primary']);
    } finally {
      db.close();
    }
  });

  it('skips when the token kind does not match the prop kind', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'map tokens' });
      seedComponentWithTokenProp(db, sessionId, 'Button', 'color', 'color');
      seedToken(db, sessionId, 'spacing.md', 'dimension');

      const calls: MapTokenPropCall[] = [
        { tool: 'map_token_prop', component: 'Button', prop: 'color', token_allowed: ['spacing.md'] },
      ];
      const result = applyMapTokenPropCalls(db, sessionId, calls, []);
      expect(result.applied).toBe(0);
      expect(result.warnings.some((w) => w.includes('dropped'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('skips unknown components with a warning', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'map tokens' });
      const calls: MapTokenPropCall[] = [
        { tool: 'map_token_prop', component: 'Nope', prop: 'color', token_allowed: ['colors.brand.primary'] },
      ];
      const result = applyMapTokenPropCalls(db, sessionId, calls, []);
      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toContain("unknown component 'Nope'");
    } finally {
      db.close();
    }
  });
});
