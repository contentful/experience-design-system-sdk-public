import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { computeTokenBackedEnumAnnotations } from '../../src/map-tokens/token-backed-enum-annotations.js';
import { openPipelineDb, getOrCreateSession, storeRawComponents, loadRawComponents } from '../../src/session/db.js';

const tree = {
  color: { $type: 'color', gray: { 300: { $value: '#ccc' } }, green: { 300: { $value: '#0f0' } } },
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

interface SeedEnumFixtureResult {
  db: DatabaseSync;
  sessionId: string;
}

async function seedEnumFixture(values: string[], styles: string): Promise<SeedEnumFixtureResult> {
  const dir = await mkdtemp(join(tmpdir(), 'token-backed-enum-test-'));
  tempDirs.push(dir);

  const stylesPath = join(dir, 'Pill.styles.ts');
  const pillPath = join(dir, 'Pill.tsx');
  await writeFile(stylesPath, `${styles}\nexport { variantStyles };\n`, 'utf8');
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
        sourcePath: pillPath,
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
    ],
    { status: 'generated' },
  );

  const componentId = loadRawComponents(db, sessionId)[0]!.component_id;

  db.prepare(
    `UPDATE raw_props SET cdf_type = 'enum', cdf_category = 'design' WHERE session_id = ? AND component_id = ? AND name = 'variant'`,
  ).run(sessionId, componentId);

  const insertAllowedValue = db.prepare(
    `INSERT INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value) VALUES (?, ?, ?, ?, ?)`,
  );
  values.forEach((v, i) => insertAllowedValue.run(sessionId, componentId, 'variant', i, v));

  return { db, sessionId };
}

describe('computeTokenBackedEnumAnnotations', () => {
  it('annotates an enum prop whose every value resolves to a design token', async () => {
    const { db, sessionId } = await seedEnumFixture(
      ['neutral', 'positive'],
      "const variantStyles = { neutral: 'color.gray.300', positive: 'color.green.300' };",
    );

    const annotations = await computeTokenBackedEnumAnnotations(db, sessionId, tree);

    expect(annotations).toEqual([{ component: 'Pill', prop: 'variant', resolved: 2, total: 2 }]);
    db.close();
  });

  it('omits a prop that only partially resolves', async () => {
    const { db, sessionId } = await seedEnumFixture(
      ['neutral', 'positive'],
      "const variantStyles = { neutral: 'color.gray.300', positive: '#00ff00' };",
    );

    const annotations = await computeTokenBackedEnumAnnotations(db, sessionId, tree);

    expect(annotations).toEqual([]);
    db.close();
  });

  it('omits a prop that does not resolve at all', async () => {
    const { db, sessionId } = await seedEnumFixture(['a', 'b'], 'const variantStyles = { a: 1, b: 2 };');

    const annotations = await computeTokenBackedEnumAnnotations(db, sessionId, tree);

    expect(annotations).toEqual([]);
    db.close();
  });

  it('returns no annotations when the tree is empty', async () => {
    const { db, sessionId } = await seedEnumFixture(
      ['neutral', 'positive'],
      "const variantStyles = { neutral: 'color.gray.300', positive: 'color.green.300' };",
    );

    const annotations = await computeTokenBackedEnumAnnotations(db, sessionId, {});

    expect(annotations).toEqual([]);
    db.close();
  });
});
