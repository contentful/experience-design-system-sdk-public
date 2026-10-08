import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import { openPipelineDb, getOrCreateSession, storeRawComponents, loadRawComponents } from '../session/db.js';

function sampleComponent(name = 'Button'): RawComponentDefinition {
  return {
    name,
    source: 'src/Button.tsx',
    framework: 'react',
    props: [{ name: 'label', type: 'string', required: true }],
    slots: [{ name: 'icon', isDefault: false }],
  };
}

describe('storeRawComponents + loadRawComponents (round-trip)', () => {
  it('round-trips a single component including props and slots', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [sampleComponent('Button')]);
      const rows = loadRawComponents(db, sessionId);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.name).toBe('Button');
      expect(row.props.map((p) => p.name)).toEqual(['label']);
      expect(row.slots.map((s) => s.name)).toEqual(['icon']);
    } finally {
      db.close();
    }
  });

  it('scopes components by session', () => {
    const db = openPipelineDb(':memory:');
    try {
      const s1 = getOrCreateSession(db, undefined, 'first', { command: 'analyze extract' });
      const s2 = getOrCreateSession(db, undefined, 'second', { command: 'analyze extract' });
      storeRawComponents(db, s1.sessionId, [sampleComponent('A')]);
      storeRawComponents(db, s2.sessionId, [sampleComponent('B')]);
      expect(loadRawComponents(db, s1.sessionId).map((c) => c.name)).toEqual(['A']);
      expect(loadRawComponents(db, s2.sessionId).map((c) => c.name)).toEqual(['B']);
    } finally {
      db.close();
    }
  });
});
