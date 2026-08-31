import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { warnUnresolvedTokenBindings } from '../../src/map-tokens/token-binding-warning.js';
import { openPipelineDb, getOrCreateSession, storeRawComponents, loadRawComponents } from '../../src/session/db.js';

const tokensInline = JSON.stringify({
  color: { $type: 'color', gray: { 300: { $value: '#ccc' } }, green: { 300: { $value: '#0f0' } } },
  spacing: { $type: 'dimension', small: { $value: '4px' } },
});
const tokenMapInline = JSON.stringify({
  'tokens.gray300': 'color.gray.300',
  'tokens.green300': 'color.green.300',
  'tokens.small': 'spacing.small',
});

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

interface SeedPillFixtureOptions {
  values: string[];
  styles: string;
}

interface SeedPillFixtureResult {
  db: DatabaseSync;
  sessionId: string;
  componentId: string;
}

/**
 * Writes a temp `Pill.tsx` that imports `./Pill.styles.ts`, and seeds a
 * session with a `Pill` component whose `variant` prop is already
 * classified as `token` (as the LLM classifier would have left it), with
 * the given allowed values.
 */
async function seedPillFixture(opts: SeedPillFixtureOptions): Promise<SeedPillFixtureResult> {
  const dir = await mkdtemp(join(tmpdir(), 'token-binding-warning-test-'));
  tempDirs.push(dir);

  const stylesPath = join(dir, 'Pill.styles.ts');
  const pillPath = join(dir, 'Pill.tsx');
  await writeFile(stylesPath, `${opts.styles}\nexport { variantStyles };\n`, 'utf8');
  await writeFile(
    pillPath,
    `import { variantStyles } from './Pill.styles';\n\nexport function Pill(props: { variant: string }) {\n  return variantStyles[props.variant];\n}\n`,
    'utf8',
  );

  const dbPath = join(dir, 'pipeline.db');
  const db = openPipelineDb(dbPath);

  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });

  storeRawComponents(
    db,
    sessionId,
    [
      {
        name: 'Pill',
        source: pillPath,
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
    ],
    { status: 'generated' },
  );

  const componentId = loadRawComponents(db, sessionId)[0]!.component_id;

  db.prepare(
    `UPDATE raw_props SET cdf_type = 'token', cdf_category = 'design' WHERE session_id = ? AND component_id = ? AND name = 'variant'`,
  ).run(sessionId, componentId);

  const insertAllowedValue = db.prepare(
    `INSERT INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value) VALUES (?, ?, ?, ?, ?)`,
  );
  opts.values.forEach((v, i) => insertAllowedValue.run(sessionId, componentId, 'variant', i, v));

  return { db, sessionId, componentId };
}

describe('warnUnresolvedTokenBindings', () => {
  it('does not warn when every value resolves to a design token', async () => {
    const { db, sessionId } = await seedPillFixture({
      values: ['neutral', 'positive'],
      styles: 'const variantStyles = { neutral: tokens.gray300, positive: tokens.green300 };',
    });

    const result = await warnUnresolvedTokenBindings(db, sessionId, { tokensInline, tokenMapInline });

    expect(result.warnings).toEqual([]);
    db.close();
  });

  it('warns naming the unresolved values when a prop resolves only partially', async () => {
    const { db, sessionId } = await seedPillFixture({
      values: ['neutral', 'positive'],
      styles: "const variantStyles = { neutral: tokens.gray300, positive: '#00ff00' };",
    });

    const result = await warnUnresolvedTokenBindings(db, sessionId, { tokensInline, tokenMapInline });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('1 of 2');
    expect(result.warnings[0]).toContain('positive');
    db.close();
  });

  it('warns when none of the values resolve to a design token', async () => {
    const { db, sessionId } = await seedPillFixture({
      values: ['neutral', 'positive'],
      styles: "const variantStyles = { neutral: '#000000', positive: '#00ff00' };",
    });

    const result = await warnUnresolvedTokenBindings(db, sessionId, { tokensInline, tokenMapInline });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('none of its 2 values');
    db.close();
  });

  it('does not warn when the prop has no values to resolve', async () => {
    const { db, sessionId } = await seedPillFixture({
      values: [],
      styles: 'const variantStyles = {};',
    });

    const result = await warnUnresolvedTokenBindings(db, sessionId, { tokensInline, tokenMapInline });

    expect(result.warnings).toEqual([]);
    db.close();
  });

  it('warns distinctly when every value resolves but to inconsistent token types', async () => {
    const { db, sessionId } = await seedPillFixture({
      values: ['neutral', 'positive'],
      styles: 'const variantStyles = { neutral: tokens.gray300, positive: tokens.small };',
    });

    const result = await warnUnresolvedTokenBindings(db, sessionId, { tokensInline, tokenMapInline });

    expect(result.warnings).toHaveLength(1);
    // Must not read as "some values are unresolved" — all of them resolved,
    // just to more than one token $type.
    expect(result.warnings[0]).toContain('all 2 values resolve');
    expect(result.warnings[0]).toContain('not to a single consistent token type');
    expect(result.warnings[0]).not.toContain('unresolved:');
    db.close();
  });

  it('warns when no token document is supplied for a token-classified prop with values', async () => {
    const { db, sessionId } = await seedPillFixture({
      values: ['neutral', 'positive'],
      styles: 'const variantStyles = { neutral: tokens.gray300, positive: tokens.green300 };',
    });

    const result = await warnUnresolvedTokenBindings(db, sessionId, {});

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no token document/i);
    db.close();
  });
});
