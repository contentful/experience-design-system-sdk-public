import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  updateStep,
  storeCDFComponents,
  storeDTCGTokens,
} from '../../src/session/db.js';
import type { CDFComponentEntry, DTCGTokenEntry, DTCGTokenGroup } from '@contentful/experience-design-system-types';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function run(args: string[], dbPath: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
  return new Promise((res) => {
    execFile('node', [bin, ...args], { env }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

const BUTTON_CDF_ENTRY: CDFComponentEntry = {
  $type: 'component',
  $description: 'A button',
  $properties: {
    label: { $type: 'string', $category: 'content', $required: true },
    variant: { $type: 'enum', $category: 'design', $values: ['primary', 'secondary'] },
  },
};

const SAMPLE_GROUPS: DTCGTokenGroup[] = [
  { path: 'color', tokenIds: [], $description: 'Colors' },
  { path: 'color.brand', tokenIds: [] },
];

const SAMPLE_TOKENS: DTCGTokenEntry[] = [
  { path: 'color.brand.primary', $type: 'color', $value: '#3b82f6', $description: 'Primary brand' },
  { path: 'color.brand.secondary', $type: 'color', $value: '#64748b' },
];

async function seedComponentsDb(dbPath: string): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
  storeCDFComponents(db, sessionId, [{ key: 'Button', entry: BUTTON_CDF_ENTRY }]);
  const stepId = createStep(db, sessionId, 'generate components', {});
  updateStep(db, stepId, 'complete', {});
  db.close();
  return sessionId;
}

async function seedTokensDb(dbPath: string): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });
  storeDTCGTokens(db, sessionId, SAMPLE_GROUPS, SAMPLE_TOKENS);
  const stepId = createStep(db, sessionId, 'generate tokens', {});
  updateStep(db, stepId, 'complete', {});
  db.close();
  return sessionId;
}

// ─── print components ─────────────────────────────────────────────────────────

describe('print components', () => {
  it('writes components.json with correct CDF structure', async () => {
    const dbDir = await createTempDir('print-comp-');
    const outDir = await createTempDir('print-comp-out-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedComponentsDb(dbPath);
    const outPath = join(outDir, 'components.json');

    const { stdout, code } = await run(['print', 'components', '--session', sid, '--out', outPath], dbPath);
    expect(code).toBe(0);
    expect(stdout).toContain('wrote components.json');
    expect(stdout).toContain('1 component');

    const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;
    expect(written['$schema']).toBe('https://contentful.com/schemas/cdf/v1');
    expect(written['Button']).toBeDefined();
    const button = written['Button'] as CDFComponentEntry;
    expect(button.$description).toBe('A button');
    expect(button.$properties['label']?.$required).toBe(true);
    expect(button.$properties['variant']?.$values).toEqual(['primary', 'secondary']);
  });

  it('auto-resolves to most recent generate components session', async () => {
    const dbDir = await createTempDir('print-comp-auto-');
    const outDir = await createTempDir('print-comp-auto-out-');
    const dbPath = join(dbDir, 'pipeline.db');
    await seedComponentsDb(dbPath);
    const outPath = join(outDir, 'components.json');

    const { code } = await run(['print', 'components', '--out', outPath], dbPath);
    expect(code).toBe(0);
    expect(await readFile(outPath, 'utf8')).toContain('Button');
  });

  it('creates parent directory if it does not exist', async () => {
    const dbDir = await createTempDir('print-comp-mkdir-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedComponentsDb(dbPath);
    const outPath = join(dbDir, 'nested', 'deep', 'components.json');

    const { code } = await run(['print', 'components', '--session', sid, '--out', outPath], dbPath);
    expect(code).toBe(0);
    const s = await stat(outPath);
    expect(s.isFile()).toBe(true);
  });

  it('exits 1 when session has no generated components', async () => {
    const dbDir = await createTempDir('print-comp-empty-');
    const dbPath = join(dbDir, 'pipeline.db');
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
    db.close();

    const { stderr, code } = await run(
      ['print', 'components', '--session', sessionId, '--out', '/tmp/out.json'],
      dbPath,
    );
    expect(code).toBe(1);
    expect(stderr).toContain('no generated components');
    expect(stderr).toContain('generate components first');
  });

  it('exits 1 with an accept-guidance message when every component was rejected at final review', async () => {
    const dbDir = await createTempDir('print-comp-rejected-');
    const dbPath = join(dbDir, 'pipeline.db');
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
    // Simulate the final-review outcome: components were generated then all
    // rejected / left unresolved, so none remain with status 'generated'.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, status)
       VALUES (?, ?, ?, '', 'react', ?, 'generate-rejected')`,
    ).run(sessionId, 'c0', 'Article', now);
    db.close();

    const { stderr, code } = await run(
      ['print', 'components', '--session', sessionId, '--out', '/tmp/out.json'],
      dbPath,
    );
    expect(code).toBe(1);
    expect(stderr).toContain('rejected or left unresolved');
    expect(stderr).toMatch(/\[a\]|\[A\]/);
    expect(stderr).toContain('--allow-empty');
    expect(stderr).not.toContain('Run generate components first');
  });

  it('--allow-empty writes an empty-but-present manifest when all components were rejected (delete-all)', async () => {
    const dbDir = await createTempDir('print-comp-allow-empty-');
    const dbPath = join(dbDir, 'pipeline.db');
    const outPath = join(dbDir, 'components.json');
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate components' });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, status)
       VALUES (?, ?, ?, '', 'react', ?, 'generate-rejected')`,
    ).run(sessionId, 'c0', 'Article', now);
    db.close();

    const { code } = await run(
      ['print', 'components', '--session', sessionId, '--out', outPath, '--allow-empty'],
      dbPath,
    );
    expect(code).toBe(0);
    const written = JSON.parse(await readFile(outPath, 'utf8'));
    // Present-but-empty: only the $schema key, no component entries → push deletes all.
    expect(written.$schema).toBeTruthy();
    expect(Object.keys(written).filter((k) => k !== '$schema')).toEqual([]);
  });

  it('exits 1 when no sessions exist', async () => {
    const dbDir = await createTempDir('print-comp-no-session-');
    const dbPath = join(dbDir, 'pipeline.db');
    openPipelineDb(dbPath).close();

    const { stderr, code } = await run(['print', 'components', '--out', '/tmp/out.json'], dbPath);
    expect(code).toBe(1);
    expect(stderr).toContain('no completed generate components session');
  });

  it('exits 1 when --out is a directory', async () => {
    const dbDir = await createTempDir('print-comp-dir-');
    const outDir = await createTempDir('print-comp-is-dir-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedComponentsDb(dbPath);

    const { stderr, code } = await run(['print', 'components', '--session', sid, '--out', outDir], dbPath);
    expect(code).toBe(1);
    expect(stderr).toContain('not a directory');
  });
});

// ─── print tokens ─────────────────────────────────────────────────────────────

describe('print tokens', () => {
  it('writes tokens.json with correct DTCG tree structure', async () => {
    const dbDir = await createTempDir('print-tok-');
    const outDir = await createTempDir('print-tok-out-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedTokensDb(dbPath);
    const outPath = join(outDir, 'tokens.json');

    const { stdout, code } = await run(['print', 'tokens', '--session', sid, '--out', outPath], dbPath);
    expect(code).toBe(0);
    expect(stdout).toContain('wrote tokens.json');
    expect(stdout).toContain('2 tokens');

    const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;
    const color = written['color'] as Record<string, unknown>;
    expect(color['$description']).toBe('Colors');
    const brand = color['brand'] as Record<string, unknown>;
    const primary = brand['primary'] as Record<string, unknown>;
    expect(primary['$type']).toBe('color');
    expect(primary['$value']).toBe('#3b82f6');
    expect(primary['$description']).toBe('Primary brand');
    const secondary = brand['secondary'] as Record<string, unknown>;
    expect(secondary['$value']).toBe('#64748b');
    expect(secondary['$description']).toBeUndefined();
  });

  it('round-trips complex $value types', async () => {
    const dbDir = await createTempDir('print-tok-complex-');
    const outDir = await createTempDir('print-tok-complex-out-');
    const dbPath = join(dbDir, 'pipeline.db');
    const shadowValue = { color: '#000', offsetX: 0, offsetY: 2, blur: 4, spread: 0 };

    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });
    storeDTCGTokens(db, sessionId, [], [{ path: 'effects.shadow', $type: 'shadow', $value: shadowValue }]);
    const stepId = createStep(db, sessionId, 'generate tokens', {});
    updateStep(db, stepId, 'complete', {});
    db.close();

    const outPath = join(outDir, 'tokens.json');
    const { code } = await run(['print', 'tokens', '--session', sessionId, '--out', outPath], dbPath);
    expect(code).toBe(0);

    const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;
    const effects = written['effects'] as Record<string, unknown>;
    expect((effects['shadow'] as Record<string, unknown>)['$value']).toEqual(shadowValue);
  });

  it('auto-resolves to most recent generate tokens session', async () => {
    const dbDir = await createTempDir('print-tok-auto-');
    const outDir = await createTempDir('print-tok-auto-out-');
    const dbPath = join(dbDir, 'pipeline.db');
    await seedTokensDb(dbPath);
    const outPath = join(outDir, 'tokens.json');

    const { code } = await run(['print', 'tokens', '--out', outPath], dbPath);
    expect(code).toBe(0);
    expect(await readFile(outPath, 'utf8')).toContain('color');
  });

  it('exits 1 when session has no generated tokens', async () => {
    const dbDir = await createTempDir('print-tok-empty-');
    const dbPath = join(dbDir, 'pipeline.db');
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'generate tokens' });
    db.close();

    const { stderr, code } = await run(['print', 'tokens', '--session', sessionId, '--out', '/tmp/out.json'], dbPath);
    expect(code).toBe(1);
    expect(stderr).toContain('no generated tokens');
    expect(stderr).toContain('generate tokens first');
  });

  it('exits 1 when no sessions exist', async () => {
    const dbDir = await createTempDir('print-tok-no-session-');
    const dbPath = join(dbDir, 'pipeline.db');
    openPipelineDb(dbPath).close();

    const { stderr, code } = await run(['print', 'tokens', '--out', '/tmp/out.json'], dbPath);
    expect(code).toBe(1);
    expect(stderr).toContain('no completed generate tokens session');
  });

  it('exits 1 when --out is a directory', async () => {
    const dbDir = await createTempDir('print-tok-dir-');
    const outDir = await createTempDir('print-tok-is-dir-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedTokensDb(dbPath);

    const { stderr, code } = await run(['print', 'tokens', '--session', sid, '--out', outDir], dbPath);
    expect(code).toBe(1);
    expect(stderr).toContain('not a directory');
  });
});
