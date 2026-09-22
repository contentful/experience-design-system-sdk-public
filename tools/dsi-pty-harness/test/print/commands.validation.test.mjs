/**
 * Tier 5 — `experiences print components/tokens/validate`.
 *
 * `print components --session <id> --out <path>` reads generated CDF
 * definitions from pipeline.db and writes a CDF JSON file to disk.
 * `print validate --components <path>` validates a CDF file against the
 * schema. `print tokens` mirrors `print components` for DTCG.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../helpers/seed-pipeline-db.mjs';
import { REACT_MINIMAL_COMPONENTS_JSON } from '../helpers/fixtures.mjs';

describe('print components', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('--session <id> --out <path> writes a CDF JSON file to disk', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);
    const outPath = join(t.home, 'components.json');

    const { stdout, code } = await runCli(
      [
        'print',
        'components',
        '--session',
        SEEDED_SESSION_ID,
        '--out',
        outPath,
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(0);
    expect(stdout).toMatch(/wrote components\.json/);
    expect(existsSync(outPath)).toBe(true);
    const cdf = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(cdf.$schema).toMatch(/cdf/i);
    expect(cdf.Button).toBeDefined();
    expect(cdf.Card).toBeDefined();
    expect(cdf.Icon).toBeDefined();
  });

  it('unknown --session exits 1 with a "no generated components" error', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);
    const outPath = join(t.home, 'components.json');

    const { stderr, code } = await runCli(
      [
        'print',
        'components',
        '--session',
        'ghost-session-xyz',
        '--out',
        outPath,
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/no generated components|session/i);
    expect(existsSync(outPath)).toBe(false);
  });
});

describe('print validate', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('--components <path> reports valid=true for the fixture CDF', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stdout, code } = await runCli(
      ['print', 'validate', '--components', REACT_MINIMAL_COMPONENTS_JSON],
      { env: t.env },
    );
    expect(code).toBe(0);
    // The formatDiagnostics output includes a "valid" or "passed" verdict.
    expect(stdout.toLowerCase()).toMatch(/valid|✓|passed|ok/);
  });

  it('rejects a malformed CDF file with exit 1', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const bad = join(t.home, 'bad.json');
    // No $schema; a component with a bogus $type.
    writeFileSync(
      bad,
      JSON.stringify({
        Bad: { $type: 'not-a-component', $properties: {} },
      }),
    );
    const { code } = await runCli(
      ['print', 'validate', '--components', bad],
      { env: t.env },
    );
    expect(code).toBe(1);
  });

  it('requires at least one of --components or --tokens', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, code } = await runCli(['print', 'validate'], { env: t.env });
    expect(code).toBe(1);
    expect(stderr).toMatch(/at least one of --components or --tokens/);
  });
});
