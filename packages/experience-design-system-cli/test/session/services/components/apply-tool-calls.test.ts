import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { openPipelineDb } from '../../../../src/session/db.js';
import { storeRawComponents } from '../../../../src/session/services/components/store-raw-components.js';
import { applyToolCalls } from '../../../../src/session/services/components/apply-tool-calls.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function seed(): Promise<{ db: DatabaseSync; componentId: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'apply-tool-calls-test-'));
  tempDirs.push(dir);
  const db = openPipelineDb(join(dir, 'pipeline.db'));
  db.prepare('DELETE FROM sessions').run();
  db.prepare(
    `INSERT INTO sessions (id, name, created_at, updated_at) VALUES ('S', null, '2026-09-18T00:00:00.000Z', '2026-09-18T00:00:00.000Z')`,
  ).run();
  storeRawComponents(db, 'S', [
    {
      name: 'Button',
      source: 'src/Button.tsx',
      framework: 'react',
      props: [
        { name: 'variant', type: 'string', required: true, allowedValues: ['a', 'b'] },
        { name: 'onClick', type: '() => void', required: false },
        { name: 'isBusy', type: 'boolean', required: false },
        { name: 'colorToken', type: 'string', required: false },
      ],
      slots: [
        { name: 'children', isDefault: true },
        { name: 'icon', isDefault: false, allowedComponents: ['A', 'B'] },
      ],
    },
  ]);
  const row = db
    .prepare(`SELECT component_id FROM raw_components WHERE session_id = 'S' AND name = 'Button'`)
    .get() as { component_id: string };
  return { db, componentId: row.component_id };
}

describe('applyToolCalls', () => {
  it('classify_prop with values updates cdf and replaces allowed values', async () => {
    const { db, componentId } = await seed();
    const result = applyToolCalls(
      db,
      'S',
      componentId,
      'Button',
      [
        {
          tool: 'classify_prop',
          prop: 'variant',
          cdf_type: 'enum',
          cdf_category: 'design',
          values: ['x', 'y'],
        },
      ],
      [],
    );
    expect(result.classified).toBe(1);
    expect(result.warnings).toEqual([]);
    const prop = db
      .prepare(`SELECT cdf_type, cdf_category FROM raw_props WHERE session_id = 'S' AND name = 'variant'`)
      .get() as { cdf_type: string; cdf_category: string };
    expect(prop.cdf_type).toBe('enum');
    const avs = db
      .prepare(
        `SELECT value FROM raw_prop_allowed_values WHERE session_id = 'S' AND prop_name = 'variant' ORDER BY position`,
      )
      .all() as Array<{ value: string }>;
    expect(avs.map((r) => r.value)).toEqual(['x', 'y']);
    db.close();
  });

  it('classify_prop token drops values and emits warning', async () => {
    const { db, componentId } = await seed();
    const result = applyToolCalls(
      db,
      'S',
      componentId,
      'Button',
      [
        {
          tool: 'classify_prop',
          prop: 'colorToken',
          cdf_type: 'token',
          cdf_category: 'design',
          token_kind: 'color',
          values: ['red', 'blue'],
        },
      ],
      [],
    );
    expect(result.classified).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/dropped 2 values on a token property/);
    const avs = db
      .prepare(`SELECT COUNT(*) AS n FROM raw_prop_allowed_values WHERE session_id = 'S' AND prop_name = 'colorToken'`)
      .get() as { n: number };
    expect(avs.n).toBe(0);
    db.close();
  });

  it('classify_prop not-found emits warning and no changes', async () => {
    const { db, componentId } = await seed();
    const result = applyToolCalls(
      db,
      'S',
      componentId,
      'Button',
      [{ tool: 'classify_prop', prop: 'ghost', cdf_type: 'enum', cdf_category: 'design' }],
      [],
    );
    expect(result.classified).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/prop not found/);
    db.close();
  });

  it('exclude_prop cascade uses boolean cdf_type for boolean-typed props', async () => {
    const { db, componentId } = await seed();
    applyToolCalls(
      db,
      'S',
      componentId,
      'Button',
      [
        { tool: 'exclude_prop', prop: 'isBusy', reason: 'internal state' },
        { tool: 'exclude_prop', prop: 'onClick', reason: 'handler' },
      ],
      [],
    );
    const rows = db
      .prepare(
        `SELECT name, cdf_type, cdf_category, required FROM raw_props WHERE session_id = 'S' AND name IN ('isBusy','onClick') ORDER BY name`,
      )
      .all() as Array<{ name: string; cdf_type: string; cdf_category: string; required: number }>;
    expect(rows).toEqual([
      { name: 'isBusy', cdf_type: 'boolean', cdf_category: 'unattached', required: 0 },
      { name: 'onClick', cdf_type: 'string', cdf_category: 'unattached', required: 0 },
    ]);
    db.close();
  });

  it('classify_slot replaces allowed_components', async () => {
    const { db, componentId } = await seed();
    const result = applyToolCalls(
      db,
      'S',
      componentId,
      'Button',
      [
        {
          tool: 'classify_slot',
          slot: 'icon',
          required: false,
          description: 'optional',
          allowed_components: ['X', 'Y', 'Z'],
        },
      ],
      [],
    );
    expect(result.slots).toBe(1);
    const acs = db
      .prepare(
        `SELECT allowed_component FROM raw_slot_allowed_components WHERE session_id = 'S' AND slot_name = 'icon' ORDER BY position`,
      )
      .all() as Array<{ allowed_component: string }>;
    expect(acs.map((r) => r.allowed_component)).toEqual(['X', 'Y', 'Z']);
    db.close();
  });

  it('classify_slot not-found emits warning', async () => {
    const { db, componentId } = await seed();
    const result = applyToolCalls(
      db,
      'S',
      componentId,
      'Button',
      [{ tool: 'classify_slot', slot: 'nope', description: 'x' }],
      [],
    );
    expect(result.slots).toBe(0);
    expect(result.warnings[0]).toMatch(/slot not found/);
    db.close();
  });

  it('preserves incoming warnings and marks component generated', async () => {
    const { db, componentId } = await seed();
    const before = db
      .prepare(`SELECT status FROM raw_components WHERE session_id = 'S' AND component_id = ?`)
      .get(componentId) as { status: string };
    expect(before.status).toBe('extracted');
    const result = applyToolCalls(db, 'S', componentId, 'Button', [], ['prior warning']);
    expect(result.warnings).toEqual(['prior warning']);
    const after = db
      .prepare(`SELECT status FROM raw_components WHERE session_id = 'S' AND component_id = ?`)
      .get(componentId) as { status: string };
    expect(after.status).toBe('generated');
    db.close();
  });
});
