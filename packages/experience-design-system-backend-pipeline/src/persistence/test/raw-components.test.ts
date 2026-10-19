import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bucketComponentProps } from '@contentful/experience-design-system-extraction';
import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
} from '../src/session/repositories/db.js';

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

function provenanceComponent(): RawComponentDefinition {
  return {
    ...sampleComponent('Field'),
    props: [
      { name: 'name', type: 'string', required: false, domAttribute: true, allowedValues: ['contact'] },
      { name: 'icon', type: 'string', required: false, domAttribute: false },
      { name: 'label', type: 'string', required: true },
    ],
  };
}

describe('saved prop provenance', () => {
  it('round-trips true, false and absent provenance and derives the same advisory buckets', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const component = provenanceComponent();
      storeRawComponents(db, sessionId, [component]);
      const reloaded = loadRawComponents(db, sessionId)[0]!;
      expect(reloaded.props).toEqual(component.props);
      expect(reloaded.props[2]).not.toHaveProperty('domAttribute');
      expect(bucketComponentProps(reloaded)).toEqual(bucketComponentProps(component));
    } finally {
      db.close();
    }
  });

  it.each(['absent-column', 'old-category'] as const)('migrates %s without losing saved fields', (kind) => {
    const dir = mkdtempSync(join(tmpdir(), 'prop-provenance-'));
    const path = join(dir, 'pipeline.db');
    try {
      const db = openPipelineDb(path);
      let sessionId: string;
      const component = provenanceComponent();
      try {
        ({ sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }));
        storeRawComponents(db, sessionId, [component]);
        if (kind === 'absent-column') {
          const columns = db.prepare('PRAGMA table_info(raw_props)').all() as Array<{ name: string }>;
          if (columns.some((column) => column.name === 'dom_attribute')) {
            db.exec('ALTER TABLE raw_props DROP COLUMN dom_attribute');
          }
        } else {
          const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'raw_props'").get() as { sql: string };
          db.exec('PRAGMA foreign_keys = OFF');
          db.exec('BEGIN');
          db.exec(
            sql
              .replace(/CREATE TABLE ["']?raw_props["']?/, 'CREATE TABLE raw_props_legacy')
              .replace(", 'unattached'", ''),
          );
          db.exec('INSERT INTO raw_props_legacy SELECT * FROM raw_props');
          db.exec('DROP TABLE raw_props');
          db.exec('ALTER TABLE raw_props_legacy RENAME TO raw_props');
          db.exec('COMMIT');
        }
      } finally {
        db.close();
      }
      for (let reopen = 0; reopen < 2; reopen++) {
        const migrated = openPipelineDb(path);
        try {
          const columns = migrated.prepare('PRAGMA table_info(raw_props)').all() as Array<{
            name: string;
            notnull: number;
          }>;
          expect(columns.filter((column) => column.name === 'dom_attribute')).toEqual([
            expect.objectContaining({ notnull: 0 }),
          ]);
          const expected =
            kind === 'absent-column'
              ? component.props.map(({ domAttribute: _provenance, ...prop }) => prop)
              : component.props;
          expect(loadRawComponents(migrated, sessionId).map((row) => row.props)).toEqual([expected]);
          const { sql } = migrated.prepare("SELECT sql FROM sqlite_master WHERE name = 'raw_props'").get() as {
            sql: string;
          };
          expect(sql).toContain("'unattached'");
        } finally {
          migrated.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid provenance and keeps previously saved components on a failed replacement', () => {
    const db = openPipelineDb(':memory:');
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const component = provenanceComponent();
      storeRawComponents(db, sessionId, [component]);
      expect(() => db.prepare('UPDATE raw_props SET dom_attribute = 2').run()).toThrow(/CHECK constraint failed/);
      const duplicate = { ...component, props: [component.props[0]!, component.props[0]!] };
      expect(() => storeRawComponents(db, sessionId, [duplicate])).toThrow(/UNIQUE constraint failed/);
      expect(loadRawComponents(db, sessionId)[0]?.props).toEqual(component.props);
    } finally {
      db.close();
    }
  });
});
