import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
  loadCDFComponents,
  applyToolCalls,
  applyTokenToolCalls,
  loadDTCGTokens,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';
import type { ToolCall, TokenToolCall } from '../../src/generate/agent-runner.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'apply-tool-calls-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const BUTTON_COMPONENT: RawComponentDefinition = {
  name: 'Button',
  source: 'src/Button.tsx',
  framework: 'react',
  props: [
    { name: 'label', type: 'string', required: true },
    { name: 'variant', type: "'primary'|'secondary'", required: false },
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'className', type: 'string', required: false },
    { name: 'bgColor', type: 'string', required: false },
  ],
  slots: [{ name: 'icon', isDefault: false, description: 'Optional icon' }],
};

function setupSession(dbPath: string) {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [BUTTON_COMPONENT]);
  const components = loadRawComponents(db, sessionId);
  const component = components.find((c) => c.name === 'Button')!;
  return { db, sessionId, componentId: component.component_id };
}

describe('applyToolCalls — classify_prop', () => {
  it('classifies a string prop and marks component as generated', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);

      const calls: ToolCall[] = [
        { tool: 'classify_component' },
        {
          tool: 'classify_prop',
          prop: 'label',
          cdf_type: 'string',
          cdf_category: 'content',
          required: true,
          description: 'Button label',
        },
        { tool: 'exclude_prop', prop: 'variant', reason: 'not needed' },
        { tool: 'exclude_prop', prop: 'disabled', reason: 'not needed' },
        { tool: 'exclude_prop', prop: 'className', reason: 'framework internal' },
        { tool: 'exclude_prop', prop: 'bgColor', reason: 'not needed' },
        { tool: 'classify_slot', slot: 'icon', required: false },
      ];

      const result = applyToolCalls(db, sessionId, componentId, 'Button', calls, []);
      expect(result.classified).toBe(1);
      expect(result.excluded).toBe(4);
      expect(result.slots).toBe(1);
      expect(result.warnings).toHaveLength(0);

      const row = db
        .prepare(`SELECT status FROM raw_components WHERE session_id = ? AND component_id = ?`)
        .get(sessionId, componentId) as { status: string };
      expect(row.status).toBe('generated');
      db.close();
    });
  });

  it('writes cdf_type and cdf_category to raw_props', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content', required: true },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        [],
      );

      const prop = db
        .prepare(
          `SELECT cdf_type, cdf_category, required FROM raw_props WHERE session_id = ? AND component_id = ? AND name = 'label'`,
        )
        .get(sessionId, componentId) as { cdf_type: string; cdf_category: string; required: number };
      expect(prop.cdf_type).toBe('string');
      expect(prop.cdf_category).toBe('content');
      expect(prop.required).toBe(1);
      db.close();
    });
  });

  it('stores enum values in raw_prop_allowed_values', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          {
            tool: 'classify_prop',
            prop: 'variant',
            cdf_type: 'enum',
            cdf_category: 'design',
            values: ['primary', 'secondary'],
          },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        [],
      );

      const rows = db
        .prepare(
          `SELECT value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = 'variant' ORDER BY position`,
        )
        .all(sessionId, componentId) as Array<{ value: string }>;
      expect(rows.map((r) => r.value)).toEqual(['primary', 'secondary']);
      db.close();
    });
  });

  it('stores token_kind for token props', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'classify_prop', prop: 'bgColor', cdf_type: 'token', cdf_category: 'design', token_kind: 'color' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        [],
      );

      const prop = db
        .prepare(
          `SELECT cdf_type, cdf_token_kind FROM raw_props WHERE session_id = ? AND component_id = ? AND name = 'bgColor'`,
        )
        .get(sessionId, componentId) as { cdf_type: string; cdf_token_kind: string };
      expect(prop.cdf_type).toBe('token');
      expect(prop.cdf_token_kind).toBe('color');
      db.close();
    });
  });

  it('nulls out cdf_type for excluded props', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'label', reason: 'not needed' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: 'framework internal' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        [],
      );

      const prop = db
        .prepare(
          `SELECT cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ? AND name = 'className'`,
        )
        .get(sessionId, componentId) as { cdf_type: string | null; cdf_category: string | null };
      expect(prop.cdf_type).toBe('excluded');
      expect(prop.cdf_category).toBeNull();
      db.close();
    });
  });

  it('warns and skips classify_prop for unknown prop names', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      const result = applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'classify_prop', prop: 'nonExistentProp', cdf_type: 'string', cdf_category: 'content' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        [],
      );

      expect(result.classified).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/nonExistentProp.*not found/);
      db.close();
    });
  });
});

describe('applyToolCalls — classify_slot', () => {
  it('writes required and description to raw_slots', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon', required: false, description: 'Optional leading icon' },
        ],
        [],
      );

      const slot = db
        .prepare(
          `SELECT required, description FROM raw_slots WHERE session_id = ? AND component_id = ? AND name = 'icon'`,
        )
        .get(sessionId, componentId) as { required: number; description: string };
      expect(slot.required).toBe(0);
      expect(slot.description).toBe('Optional leading icon');
      db.close();
    });
  });

  it('stores allowed_components for slots', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon', required: false, allowed_components: ['Icon', 'Svg'] },
        ],
        [],
      );

      const rows = db
        .prepare(
          `SELECT allowed_component FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ? AND slot_name = 'icon' ORDER BY position`,
        )
        .all(sessionId, componentId) as Array<{ allowed_component: string }>;
      expect(rows.map((r) => r.allowed_component)).toEqual(['Icon', 'Svg']);
      db.close();
    });
  });

  it('defaults slot required to 1 when not specified', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        [],
      );

      const slot = db
        .prepare(`SELECT required FROM raw_slots WHERE session_id = ? AND component_id = ? AND name = 'icon'`)
        .get(sessionId, componentId) as { required: number };
      expect(slot.required).toBe(1);
      db.close();
    });
  });

  it('warns and skips classify_slot for unknown slot names', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      const result = applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'nonExistentSlot', required: true },
        ],
        [],
      );

      expect(result.slots).toBe(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/nonExistentSlot.*not found/);
      db.close();
    });
  });
});

describe('applyToolCalls — classify_component', () => {
  it('writes description to raw_components', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component', description: 'Primary action button' },
          { tool: 'exclude_prop', prop: 'label', reason: '' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        [],
      );

      const row = db
        .prepare(`SELECT description FROM raw_components WHERE session_id = ? AND component_id = ?`)
        .get(sessionId, componentId) as { description: string };
      expect(row.description).toBe('Primary action button');
      db.close();
    });
  });
});

describe('applyToolCalls — loadCDFComponents integration', () => {
  it('classified props appear in loadCDFComponents output', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component', description: 'A button' },
          { tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content', required: true },
          {
            tool: 'classify_prop',
            prop: 'variant',
            cdf_type: 'enum',
            cdf_category: 'design',
            values: ['primary', 'secondary'],
            default: 'primary',
          },
          { tool: 'classify_prop', prop: 'disabled', cdf_type: 'boolean', cdf_category: 'state', required: false },
          { tool: 'classify_prop', prop: 'bgColor', cdf_type: 'token', cdf_category: 'design', token_kind: 'color' },
          { tool: 'exclude_prop', prop: 'className', reason: 'framework internal' },
          {
            tool: 'classify_slot',
            slot: 'icon',
            required: false,
            description: 'Optional icon',
            allowed_components: ['Icon'],
          },
        ],
        [],
      );

      const cdf = loadCDFComponents(db, sessionId);
      expect(cdf).toHaveLength(1);
      const entry = cdf[0]!;
      expect(entry.key).toBe('Button');
      expect(entry.entry.$description).toBe('A button');
      expect(entry.entry.$properties['label']?.$type).toBe('string');
      expect(entry.entry.$properties['label']?.$category).toBe('content');
      expect(entry.entry.$properties['label']?.$required).toBe(true);
      expect(entry.entry.$properties['variant']?.$type).toBe('enum');
      expect(entry.entry.$properties['variant']?.$values).toEqual(['primary', 'secondary']);
      expect(entry.entry.$properties['disabled']?.$category).toBe('state');
      expect(entry.entry.$properties['bgColor']?.$type).toBe('token');
      expect(entry.entry.$properties['className']).toBeUndefined();
      expect(entry.entry.$slots?.['icon']?.$required).toBeUndefined();
      expect(entry.entry.$slots?.['icon']?.$allowedComponents).toEqual(['Icon']);
      db.close();
    });
  });

  it('passes through incoming warnings alongside new ones', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      const result = applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          { tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content' },
          { tool: 'classify_prop', prop: 'ghost', cdf_type: 'string', cdf_category: 'content' },
          { tool: 'exclude_prop', prop: 'variant', reason: '' },
          { tool: 'exclude_prop', prop: 'disabled', reason: '' },
          { tool: 'exclude_prop', prop: 'className', reason: '' },
          { tool: 'exclude_prop', prop: 'bgColor', reason: '' },
          { tool: 'classify_slot', slot: 'icon' },
        ],
        ['pre-existing warning from parse'],
      );

      expect(result.warnings).toContain('pre-existing warning from parse');
      expect(result.warnings.some((w) => w.includes('ghost'))).toBe(true);
      db.close();
    });
  });
});

describe('applyTokenToolCalls', () => {
  it('stores tokens and groups, returns counts', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      const calls: TokenToolCall[] = [
        { tool: 'set_group', path: 'colors', description: 'Color palette' },
        { tool: 'set_group', path: 'colors.brand' },
        {
          tool: 'set_token',
          path: 'colors.brand.primary',
          type: 'color',
          value: '#0066ff',
          description: 'Primary brand color',
        },
        { tool: 'set_token', path: 'colors.brand.secondary', type: 'color', value: '#6633cc' },
        { tool: 'set_group', path: 'spacing' },
        { tool: 'set_token', path: 'spacing.sm', type: 'dimension', value: '8px' },
      ];

      const result = applyTokenToolCalls(db, sessionId, calls, []);
      expect(result.tokens).toBe(3);
      expect(result.groups).toBe(3);
      expect(result.warnings).toHaveLength(0);
      db.close();
    });
  });

  it('stored tokens are retrievable via loadDTCGTokens', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      applyTokenToolCalls(
        db,
        sessionId,
        [
          { tool: 'set_group', path: 'colors', description: 'Colors' },
          { tool: 'set_token', path: 'colors.primary', type: 'color', value: '#0066ff', description: 'Primary' },
          { tool: 'set_token', path: 'colors.secondary', type: 'color', value: '#6633cc' },
        ],
        [],
      );

      const { groups, tokens } = loadDTCGTokens(db, sessionId);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.path).toBe('colors');
      expect(groups[0]?.$description).toBe('Colors');
      expect(tokens).toHaveLength(2);
      const primary = tokens.find((t) => t.path === 'colors.primary');
      expect(primary?.$type).toBe('color');
      expect(primary?.$value).toBe('#0066ff');
      expect(primary?.$description).toBe('Primary');
      db.close();
    });
  });

  it('stores complex object values (shadow)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      const shadow = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#00000026' };
      applyTokenToolCalls(
        db,
        sessionId,
        [{ tool: 'set_token', path: 'effects.shadow', type: 'shadow', value: shadow }],
        [],
      );

      const { tokens } = loadDTCGTokens(db, sessionId);
      expect(tokens[0]?.$value).toEqual(shadow);
      db.close();
    });
  });

  it('stores array values (gradient)', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      const gradient = [
        { color: '#000', position: 0 },
        { color: '#fff', position: 1 },
      ];
      applyTokenToolCalls(
        db,
        sessionId,
        [{ tool: 'set_token', path: 'effects.gradient', type: 'gradient', value: gradient }],
        [],
      );

      const { tokens } = loadDTCGTokens(db, sessionId);
      expect(tokens[0]?.$value).toEqual(gradient);
      db.close();
    });
  });

  it('upserts — calling twice with same path updates existing row', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      applyTokenToolCalls(
        db,
        sessionId,
        [{ tool: 'set_token', path: 'spacing.sm', type: 'dimension', value: '8px' }],
        [],
      );
      applyTokenToolCalls(
        db,
        sessionId,
        [{ tool: 'set_token', path: 'spacing.sm', type: 'dimension', value: '12px' }],
        [],
      );

      const { tokens } = loadDTCGTokens(db, sessionId);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.$value).toBe('12px');
      db.close();
    });
  });

  it('passes through incoming warnings', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      const result = applyTokenToolCalls(
        db,
        sessionId,
        [{ tool: 'set_token', path: 'colors.a', type: 'color', value: '#fff' }],
        ['pre-existing warning'],
      );

      expect(result.warnings).toContain('pre-existing warning');
      db.close();
    });
  });

  it('isolates token data by session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId: sid1 } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });
      const { sessionId: sid2 } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });

      applyTokenToolCalls(db, sid1, [{ tool: 'set_token', path: 'a.token', type: 'color', value: '#aaa' }], []);
      applyTokenToolCalls(db, sid2, [{ tool: 'set_token', path: 'b.token', type: 'color', value: '#bbb' }], []);

      expect(loadDTCGTokens(db, sid1).tokens.map((t) => t.path)).toEqual(['a.token']);
      expect(loadDTCGTokens(db, sid2).tokens.map((t) => t.path)).toEqual(['b.token']);
      db.close();
    });
  });
});

describe('applyToolCalls — rationale persistence (Feature 1)', () => {
  it('persists classify_prop reason to raw_props.rationale', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      const calls: ToolCall[] = [
        {
          tool: 'classify_prop',
          prop: 'label',
          cdf_type: 'string',
          cdf_category: 'content',
          required: true,
          description: 'Button label',
          reason: 'inferred from PropertySignature with literal string type',
        },
      ];
      applyToolCalls(db, sessionId, componentId, 'Button', calls, []);

      const row = db
        .prepare(`SELECT rationale FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?`)
        .get(sessionId, componentId, 'label') as { rationale: string | null };
      expect(row.rationale).toBe('inferred from PropertySignature with literal string type');
      db.close();
    });
  });

  it('persists exclude_prop reason to raw_props.rationale', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      const calls: ToolCall[] = [
        { tool: 'exclude_prop', prop: 'className', reason: 'framework internal — not authorable' },
      ];
      applyToolCalls(db, sessionId, componentId, 'Button', calls, []);

      const row = db
        .prepare(`SELECT rationale FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?`)
        .get(sessionId, componentId, 'className') as { rationale: string | null };
      expect(row.rationale).toBe('framework internal — not authorable');
      db.close();
    });
  });

  it('writes rationale = NULL when reason is missing (backward compat)', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      const calls: ToolCall[] = [
        {
          tool: 'classify_prop',
          prop: 'label',
          cdf_type: 'string',
          cdf_category: 'content',
        },
      ];
      applyToolCalls(db, sessionId, componentId, 'Button', calls, []);

      const row = db
        .prepare(`SELECT rationale FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?`)
        .get(sessionId, componentId, 'label') as { rationale: string | null };
      expect(row.rationale).toBeNull();
      db.close();
    });
  });
});

describe('applyToolCalls - component-level rationale', () => {
  it('persists classify_component.rationale (description, props, slots) to raw_components', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          {
            tool: 'classify_component',
            description: 'Primary action button',
            rationale: {
              description: 'A CTA element',
              props: 'captured visual variants only',
              slots: 'no slots; leaf content',
            },
          },
        ],
        [],
      );
      const row = db
        .prepare(
          `SELECT description, component_description_rationale, props_rationale, slots_rationale
           FROM raw_components WHERE session_id = ? AND component_id = ?`,
        )
        .get(sessionId, componentId) as {
        description: string | null;
        component_description_rationale: string | null;
        props_rationale: string | null;
        slots_rationale: string | null;
      };
      expect(row.description).toBe('Primary action button');
      expect(row.component_description_rationale).toBe('A CTA element');
      expect(row.props_rationale).toBe('captured visual variants only');
      expect(row.slots_rationale).toBe('no slots; leaf content');
      db.close();
    });
  });

  it('persists classify_slot.rationale to raw_slots', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component' },
          {
            tool: 'classify_slot',
            slot: 'icon',
            required: false,
            description: 'Optional icon',
            rationale: 'kept because consumers commonly render a leading icon',
          },
        ],
        [],
      );
      const row = db
        .prepare(`SELECT rationale FROM raw_slots WHERE session_id = ? AND component_id = ? AND name = ?`)
        .get(sessionId, componentId, 'icon') as { rationale: string | null };
      expect(row.rationale).toBe('kept because consumers commonly render a leading icon');
      db.close();
    });
  });

  it('leaves rationale fields untouched when call omits them (sparse update)', async () => {
    await withTempDb((dbPath) => {
      const { db, sessionId, componentId } = setupSession(dbPath);
      // First call sets rationale.
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          {
            tool: 'classify_component',
            rationale: { description: 'D', props: 'P', slots: 'S' },
          },
          { tool: 'classify_slot', slot: 'icon', rationale: 'slot-why' },
        ],
        [],
      );
      // Second call omits rationale entirely — must not blank existing values.
      applyToolCalls(
        db,
        sessionId,
        componentId,
        'Button',
        [
          { tool: 'classify_component', description: 'Updated desc' },
          { tool: 'classify_slot', slot: 'icon', required: true },
        ],
        [],
      );
      const compRow = db
        .prepare(
          `SELECT description, component_description_rationale, props_rationale, slots_rationale
           FROM raw_components WHERE session_id = ? AND component_id = ?`,
        )
        .get(sessionId, componentId) as {
        description: string | null;
        component_description_rationale: string | null;
        props_rationale: string | null;
        slots_rationale: string | null;
      };
      expect(compRow.description).toBe('Updated desc');
      expect(compRow.component_description_rationale).toBe('D');
      expect(compRow.props_rationale).toBe('P');
      expect(compRow.slots_rationale).toBe('S');
      const slotRow = db
        .prepare(`SELECT rationale FROM raw_slots WHERE session_id = ? AND component_id = ? AND name = ?`)
        .get(sessionId, componentId, 'icon') as { rationale: string | null };
      expect(slotRow.rationale).toBe('slot-why');
      db.close();
    });
  });
});
