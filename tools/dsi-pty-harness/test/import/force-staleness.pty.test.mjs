/**
 * Tier 3b — `--force` bypasses the staleness check on --push-from-run
 * and --modify.
 *
 * Staleness fires when the run's sourceFingerprint no longer matches
 * the filesystem (mtime drift or a missing file). Without --force the
 * CLI/wizard refuses and points at --force as the bypass; with --force
 * it proceeds.
 *
 * We construct staleness by seeding a fingerprint that references a
 * file path that doesn't exist (the staleness helper calls stat() and
 * treats ENOENT as missing → stale).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../../src/harness.mjs';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { seedRuns } from '../helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../helpers/seed-pipeline-db.mjs';

describe('experiences import --force staleness bypass', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  function setupStale() {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);
    seedRuns(t.home, [
      {
        id: 'run-stale',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath: t.home + '/save',
        // A file that will never exist → stat throws → missingSourceFiles
        // → stale=true.
        sourceFingerprint: {
          files: {
            '/nonexistent-fixture-path.tsx': {
              mtime: '2020-01-01T00:00:00Z',
              componentName: 'Button',
            },
          },
          rawTokensPath: null,
          rawTokensMtime: null,
          rawTokensContentHash: null,
        },
      },
    ]);
    return { t, dbPath };
  }

  // ── --push-from-run: headless assertions on the refusal ─────────────────

  it('--push-from-run on a stale run without --force refuses with the "STALE" error', async () => {
    const { t, dbPath } = setupStale();
    const { code, stderr } = await runCli(
      [
        'import',
        '--push-from-run',
        'run-stale',
        '--space-id',
        's',
        '--environment-id',
        'master',
        '--cma-token',
        't',
      ],
      {
        env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath },
        timeoutMs: 20000,
      },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/Refusing to replay run run-stale/);
    expect(stderr).toMatch(/STALE/);
    // The refusal points at --force as the bypass.
    expect(stderr).toMatch(/pass --force to bypass/);
  });

  // ── --modify: PTY assertions on the refusal ─────────────────────────────

  it('--modify on a stale run without --force renders the "STALE" refusal', async () => {
    const { t, dbPath } = setupStale();
    const w = await spawnWizard(['import', '--modify', 'run-stale'], {
      env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath },
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());

    await w.waitFor(/Refusing to replay run run-stale/, { timeout: 8000 });
    const screen = w.getScreen();
    expect(screen).toMatch(/STALE/);
    expect(screen).toMatch(/pass --force to bypass/);
  });

  // ── --force bypasses ────────────────────────────────────────────────────

  it('--modify --force proceeds past the staleness check and reaches final-review', async () => {
    const { t, dbPath } = setupStale();
    const w = await spawnWizard(['import', '--modify', 'run-stale', '--force'], {
      env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath },
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());

    // With --force, the wizard skips the staleness gate and reaches
    // final-review — the seeded generated components render.
    await w.waitFor(/Button/, { timeout: 15000 });
    const screen = w.getScreen();
    expect(screen).toMatch(/\[F\]\s*finalize/i);
    // And the staleness refusal text must NOT appear.
    expect(screen).not.toMatch(/Refusing to replay/);
  });
});
