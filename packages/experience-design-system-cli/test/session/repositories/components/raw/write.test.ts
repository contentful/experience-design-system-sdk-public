import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../../src/session/db.js';
import {
  createRawComponent,
  createRawPropAllowedValue,
  createRawProps,
  createRawSlots,
  deleteRawComponentsForSession,
  deleteRawPropAllowedValuesForProp,
  updateRawComponentDescription,
  updateRawComponentsStatus,
  updateRawPropCdfByName,
  updateRawPropCdfByPosition,
} from '../../../../../src/session/repositories/components/raw/write.js';
import type { RawComponentDefinition } from '../../../../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-raw-write-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function makeComponent(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'Button',
    source: '/tmp/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

function seedSession(db: ReturnType<typeof openPipelineDb>) {
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
  return sessionId;
}

describe('createRawComponent', () => {
  it('inserts a component row and returns its derived component_id', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');

      const row = db
        .prepare(
          'SELECT component_id, name, source, framework, extracted_at, review_reasons, needs_review FROM raw_components WHERE session_id = ?',
        )
        .get(sessionId) as {
        component_id: string;
        name: string;
        source: string;
        framework: string;
        extracted_at: string;
        review_reasons: string;
        needs_review: number;
      };
      expect(row.component_id).toBe(componentId);
      expect(row.name).toBe('Button');
      expect(row.framework).toBe('react');
      expect(row.extracted_at).toBe('2026-01-01T00:00:00Z');
      expect(JSON.parse(row.review_reasons)).toEqual([]);
      expect(row.needs_review).toBe(0);
      db.close();
    });
  });

  it('serializes review_reasons and coerces needsReview to 1', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);

      createRawComponent(
        db,
        sessionId,
        makeComponent({ reviewReasons: ['low-confidence', 'ambiguous-type'], needsReview: true }),
        '2026-01-01T00:00:00Z',
      );

      const row = db
        .prepare('SELECT review_reasons, needs_review FROM raw_components WHERE session_id = ?')
        .get(sessionId) as { review_reasons: string; needs_review: number };
      expect(JSON.parse(row.review_reasons)).toEqual(['low-confidence', 'ambiguous-type']);
      expect(row.needs_review).toBe(1);
      db.close();
    });
  });
});

describe('createRawProps', () => {
  it('inserts prop rows in the given order with position matching index', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');

      createRawProps(db, sessionId, componentId, [
        { name: 'label', type: 'string', required: true },
        { name: 'variant', type: 'string', required: false },
      ]);

      const rows = db
        .prepare(
          'SELECT name, position, required FROM raw_props WHERE session_id = ? AND component_id = ? ORDER BY position',
        )
        .all(sessionId, componentId) as Array<{ name: string; position: number; required: number }>;
      expect(rows).toEqual([
        { name: 'label', position: 0, required: 1 },
        { name: 'variant', position: 1, required: 0 },
      ]);
      db.close();
    });
  });

  it('writes allowedValues for a prop that has them', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');

      createRawProps(db, sessionId, componentId, [
        { name: 'variant', type: 'string', required: false, allowedValues: ['primary', 'secondary', 'ghost'] },
      ]);

      const av = db
        .prepare(
          'SELECT prop_name, position, value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? ORDER BY position',
        )
        .all(sessionId, componentId);
      expect(av).toEqual([
        { prop_name: 'variant', position: 0, value: 'primary' },
        { prop_name: 'variant', position: 1, value: 'secondary' },
        { prop_name: 'variant', position: 2, value: 'ghost' },
      ]);
      db.close();
    });
  });
});

describe('createRawSlots', () => {
  it('inserts slot rows with position matching index', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');

      createRawSlots(db, sessionId, componentId, [
        { name: 'children', isDefault: true },
        { name: 'trailing', isDefault: false, description: 'trailing icon' },
      ]);

      const rows = db
        .prepare(
          'SELECT name, is_default, description, position FROM raw_slots WHERE session_id = ? AND component_id = ? ORDER BY position',
        )
        .all(sessionId, componentId);
      expect(rows).toEqual([
        { name: 'children', is_default: 1, description: null, position: 0 },
        { name: 'trailing', is_default: 0, description: 'trailing icon', position: 1 },
      ]);
      db.close();
    });
  });

  it('writes allowedComponents for a slot that restricts them', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');

      createRawSlots(db, sessionId, componentId, [
        { name: 'icon', isDefault: false, allowedComponents: ['Icon', 'Badge'] },
      ]);

      const rows = db
        .prepare(
          'SELECT slot_name, position, allowed_component FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ? ORDER BY position',
        )
        .all(sessionId, componentId);
      expect(rows).toEqual([
        { slot_name: 'icon', position: 0, allowed_component: 'Icon' },
        { slot_name: 'icon', position: 1, allowed_component: 'Badge' },
      ]);
      db.close();
    });
  });
});

describe('deleteRawComponentsForSession', () => {
  it('removes all raw_components rows for the session and cascades', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, componentId, [{ name: 'label', type: 'string', required: true }]);

      deleteRawComponentsForSession(db, sessionId);

      expect(db.prepare('SELECT COUNT(*) as c FROM raw_components WHERE session_id = ?').get(sessionId)).toEqual({
        c: 0,
      });
      expect(db.prepare('SELECT COUNT(*) as c FROM raw_props WHERE session_id = ?').get(sessionId)).toEqual({ c: 0 });
      db.close();
    });
  });
});

describe('updateRawComponentsStatus', () => {
  it('sets status on every component in the session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      createRawComponent(db, sessionId, makeComponent({ name: 'A' }), '2026-01-01T00:00:00Z');
      createRawComponent(db, sessionId, makeComponent({ name: 'B' }), '2026-01-01T00:00:00Z');

      updateRawComponentsStatus(db, sessionId, 'accepted');

      const statuses = (
        db.prepare('SELECT status FROM raw_components WHERE session_id = ?').all(sessionId) as Array<{ status: string }>
      ).map((r) => r.status);
      expect(statuses).toEqual(['accepted', 'accepted']);
      db.close();
    });
  });
});

describe('updateRawPropCdfByName', () => {
  it('updates the matched prop and returns 1', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, componentId, [{ name: 'variant', type: 'string', required: false }]);

      const changed = updateRawPropCdfByName(db, sessionId, componentId, 'variant', 'enum', 'design', null);

      expect(changed).toBe(1);
      const row = db
        .prepare(
          'SELECT cdf_type, cdf_category, cdf_token_kind FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?',
        )
        .get(sessionId, componentId, 'variant');
      expect(row).toEqual({ cdf_type: 'enum', cdf_category: 'design', cdf_token_kind: null });
      db.close();
    });
  });

  it('returns 0 when no prop matches', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');

      const changed = updateRawPropCdfByName(db, sessionId, componentId, 'nope', 'enum', 'design', null);
      expect(changed).toBe(0);
      db.close();
    });
  });
});

describe('updateRawPropCdfByPosition', () => {
  it('updates only when cdf_type IS NULL (preserves earlier by-name write)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, componentId, [{ name: 'variant', type: 'string', required: false }]);

      // Simulate an earlier byName write.
      updateRawPropCdfByName(db, sessionId, componentId, 'variant', 'enum', 'design', null);

      const changed = updateRawPropCdfByPosition(db, sessionId, componentId, 0, 'string', 'content', null);
      expect(changed).toBe(0);
      const row = db
        .prepare('SELECT cdf_type FROM raw_props WHERE session_id = ? AND component_id = ? AND position = 0')
        .get(sessionId, componentId);
      expect(row).toEqual({ cdf_type: 'enum' });
      db.close();
    });
  });

  it('updates when cdf_type is still NULL', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, componentId, [{ name: 'variant', type: 'string', required: false }]);

      const changed = updateRawPropCdfByPosition(db, sessionId, componentId, 0, 'enum', 'design', null);
      expect(changed).toBe(1);
      const row = db
        .prepare('SELECT cdf_type FROM raw_props WHERE session_id = ? AND component_id = ? AND position = 0')
        .get(sessionId, componentId);
      expect(row).toEqual({ cdf_type: 'enum' });
      db.close();
    });
  });
});

describe('updateRawComponentDescription', () => {
  it('sets description on the matched component', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');

      updateRawComponentDescription(db, sessionId, componentId, 'A clickable primary action.');

      const row = db
        .prepare('SELECT description FROM raw_components WHERE session_id = ? AND component_id = ?')
        .get(sessionId, componentId);
      expect(row).toEqual({ description: 'A clickable primary action.' });
      db.close();
    });
  });
});

describe('deleteRawPropAllowedValuesForProp + createRawPropAllowedValue', () => {
  it('replaces the allowed-values set for a prop', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, componentId, [
        { name: 'variant', type: 'string', required: false, allowedValues: ['a', 'b', 'c'] },
      ]);

      deleteRawPropAllowedValuesForProp(db, sessionId, componentId, 'variant');
      createRawPropAllowedValue(db, sessionId, componentId, 'variant', 0, 'primary');
      createRawPropAllowedValue(db, sessionId, componentId, 'variant', 1, 'ghost');

      const rows = db
        .prepare(
          'SELECT position, value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ? ORDER BY position',
        )
        .all(sessionId, componentId, 'variant');
      expect(rows).toEqual([
        { position: 0, value: 'primary' },
        { position: 1, value: 'ghost' },
      ]);
      db.close();
    });
  });

  it('createRawPropAllowedValue uses INSERT OR IGNORE on primary-key collision', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const componentId = createRawComponent(db, sessionId, makeComponent(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, componentId, [{ name: 'variant', type: 'string', required: false }]);

      createRawPropAllowedValue(db, sessionId, componentId, 'variant', 0, 'primary');
      // Same (session, component, prop, position) — should be ignored, not throw.
      createRawPropAllowedValue(db, sessionId, componentId, 'variant', 0, 'secondary');

      const row = db
        .prepare(
          'SELECT value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ? AND position = 0',
        )
        .get(sessionId, componentId, 'variant');
      expect(row).toEqual({ value: 'primary' });
      db.close();
    });
  });
});
