import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { openPipelineDb, getOrCreateSession } from '../../../../../src/session/db.js';
import {
  createRawComponent,
  createRawProps,
  createRawSlots,
  updateRawComponentDescription,
  updateRawPropCdfByName,
} from '../../../../../src/session/repositories/components/raw/write.js';
import {
  getClassifiedProps,
  getComponentDescriptions,
  getRawComponents,
  getRawPropAllowedValues,
  getRawPropNameAtPosition,
} from '../../../../../src/session/repositories/components/raw/read.js';
import type { RawComponentDefinition } from '../../../../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-raw-read-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dirname(dir), { recursive: true, force: true }).catch(() => {});
  }
});

function seedSession(db: ReturnType<typeof openPipelineDb>) {
  const { sessionId } = getOrCreateSession(db, undefined, undefined, { command: 'analyze extract' });
  return sessionId;
}

function comp(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'Button',
    source: '/tmp/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

describe('getRawComponents', () => {
  it('returns [] for an unknown session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      expect(getRawComponents(db, 'nonexistent')).toEqual([]);
      db.close();
    });
  });

  it('reassembles component + props + slots + allowedValues from storage', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp({ needsReview: true, reviewReasons: ['ambiguous-type'] }), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, cid, [
        { name: 'label', type: 'string', required: true },
        { name: 'variant', type: 'string', required: false, allowedValues: ['primary', 'secondary'] },
      ]);
      createRawSlots(db, sessionId, cid, [
        { name: 'children', isDefault: true },
        { name: 'trailing', isDefault: false, allowedComponents: ['Icon'] },
      ]);

      const [row] = getRawComponents(db, sessionId);
      expect(row.name).toBe('Button');
      expect(row.needsReview).toBe(true);
      expect(row.reviewReasons).toEqual(['ambiguous-type']);
      expect(row.props.map((p) => p.name)).toEqual(['label', 'variant']);
      const variant = row.props.find((p) => p.name === 'variant');
      expect(variant?.allowedValues).toEqual(['primary', 'secondary']);
      expect(row.slots.map((s) => s.name)).toEqual(['children', 'trailing']);
      const trailing = row.slots.find((s) => s.name === 'trailing');
      expect(trailing?.allowedComponents).toEqual(['Icon']);
      db.close();
    });
  });

  it('filters by allowedNames when provided', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      createRawComponent(db, sessionId, comp({ name: 'Button' }), '2026-01-01T00:00:00Z');
      createRawComponent(db, sessionId, comp({ name: 'Card' }), '2026-01-01T00:00:00Z');
      createRawComponent(db, sessionId, comp({ name: 'Text' }), '2026-01-01T00:00:00Z');

      const rows = getRawComponents(db, sessionId, new Set(['Button', 'Text']));
      expect(rows.map((r) => r.name).sort()).toEqual(['Button', 'Text']);
      db.close();
    });
  });

  it('returns [] when allowedNames is empty', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');

      expect(getRawComponents(db, sessionId, new Set())).toEqual([]);
      db.close();
    });
  });
});

describe('getClassifiedProps', () => {
  it('returns only props with a non-null cdf_type', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, cid, [
        { name: 'variant', type: 'string', required: false },
        { name: 'onClick', type: '() => void', required: false },
      ]);
      updateRawPropCdfByName(db, sessionId, cid, 'variant', 'enum', 'design', null);

      const classified = getClassifiedProps(db, sessionId);
      expect(classified).toEqual([
        { component_id: cid, name: 'variant', position: 0, cdf_type: 'enum', cdf_category: 'design', cdf_token_kind: null },
      ]);
      db.close();
    });
  });
});

describe('getComponentDescriptions', () => {
  it('returns only components with a non-null description', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const withDesc = createRawComponent(db, sessionId, comp({ name: 'Button' }), '2026-01-01T00:00:00Z');
      createRawComponent(db, sessionId, comp({ name: 'Card' }), '2026-01-01T00:00:00Z');
      updateRawComponentDescription(db, sessionId, withDesc, 'A clickable button.');

      const descs = getComponentDescriptions(db, sessionId);
      expect(descs).toEqual([{ component_id: withDesc, description: 'A clickable button.' }]);
      db.close();
    });
  });
});

describe('getRawPropAllowedValues', () => {
  it('returns every allowed value across the session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, cid, [
        { name: 'variant', type: 'string', required: false, allowedValues: ['a', 'b'] },
      ]);

      const av = getRawPropAllowedValues(db, sessionId);
      expect(av).toEqual([
        { component_id: cid, prop_name: 'variant', position: 0, value: 'a' },
        { component_id: cid, prop_name: 'variant', position: 1, value: 'b' },
      ]);
      db.close();
    });
  });
});

describe('getRawPropNameAtPosition', () => {
  it('returns the prop name at the given position', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');
      createRawProps(db, sessionId, cid, [
        { name: 'label', type: 'string', required: true },
        { name: 'variant', type: 'string', required: false },
      ]);

      expect(getRawPropNameAtPosition(db, sessionId, cid, 0)).toBe('label');
      expect(getRawPropNameAtPosition(db, sessionId, cid, 1)).toBe('variant');
      db.close();
    });
  });

  it('returns null when no prop exists at that position', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const sessionId = seedSession(db);
      const cid = createRawComponent(db, sessionId, comp(), '2026-01-01T00:00:00Z');

      expect(getRawPropNameAtPosition(db, sessionId, cid, 99)).toBeNull();
      db.close();
    });
  });
});
