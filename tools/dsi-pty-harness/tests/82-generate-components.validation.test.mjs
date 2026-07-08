/**
 * Tier 5 — `experiences generate components`.
 *
 * Uses --dry-run (prints the prompt and exits without invoking the agent)
 * so we don't need a live agent binary or stub for these tests.
 * --agent is still required (a valid name); --model is threaded through
 * but only matters when the agent actually runs.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from './helpers/seed-pipeline-db.mjs';

describe('generate components subcommand', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('--dry-run prints the prompt without invoking the agent', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stdout, code } = await runCli(
      [
        'generate',
        'components',
        '--session',
        SEEDED_SESSION_ID,
        '--agent',
        'claude',
        '--dry-run',
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(0);
    // The prompt is a substantial markdown-y body — assert it's non-trivial
    // and mentions the first component (Button) from the seeded fixture.
    expect(stdout.length).toBeGreaterThan(500);
    expect(stdout).toMatch(/Button/);
  });

  it('rejects an unknown --agent name', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stderr, code } = await runCli(
      [
        'generate',
        'components',
        '--session',
        SEEDED_SESSION_ID,
        '--agent',
        'notreal',
        '--dry-run',
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/no agent configured|Accepted values/);
  });

  it('unknown --session exits 1 with a helpful error', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stderr, code } = await runCli(
      [
        'generate',
        'components',
        '--session',
        'nope-abc123',
        '--agent',
        'claude',
        '--dry-run',
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/session|components/i);
  });

  it('--generate-prompt-path with a nonexistent path exits 1', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stderr, code } = await runCli(
      [
        'generate',
        'components',
        '--session',
        SEEDED_SESSION_ID,
        '--agent',
        'claude',
        '--dry-run',
        '--generate-prompt-path',
        '/tmp/definitely-not-a-file-xyz.md',
      ],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/custom prompt path not found/);
  });
});
