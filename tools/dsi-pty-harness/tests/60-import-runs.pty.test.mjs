/**
 * Tier 3b — `--modify` and `--push-from-run` steer the wizard into
 * runs-based flows. Both require a seeded runs.json.
 *
 * These tests seed a minimal run record and assert on the wizard state
 * the flag reaches. They do NOT drive the full flow to completion —
 * that requires seeding pipeline.db (for --modify) and a mocked EMA
 * (for --push-from-run's actual push), which lives in later tiers.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnWizard } from '../src/harness.mjs';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { seedRuns } from './helpers/seed-runs.mjs';

describe('experiences import — runs-based flags', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  // ── --push-from-run (headless): missing-credentials error ───────────────
  //
  // With a valid seeded run but no credentials, replayRun surfaces its
  // MISSING_CREDS error via the CLI's catch/exit-1 path. This proves the
  // flag reached replayRun.
  it('--push-from-run with seeded run but no credentials errors with the missing-creds message', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { ids } = seedRuns(t.home, [{ id: 'run-abc' }]);

    const { code, stderr } = await runCli(['import', '--push-from-run', ids[0]], {
      env: {
        ...t.env,
        CONTENTFUL_SPACE_ID: '',
        CONTENTFUL_ENVIRONMENT_ID: '',
        CONTENTFUL_MANAGEMENT_TOKEN: '',
      },
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/--push-from-run requires credentials/);
    expect(stderr).toMatch(/cma-token|experiences setup/);
  });

  // ── --push-from-run (PTY): prompts for credentials in the wizard ────────
  it('--push-from-run in a PTY prompts for credentials with the "Push run <id>" banner', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { ids } = seedRuns(t.home, [{ id: 'run-def' }]);

    const w = await spawnWizard(['import', '--push-from-run', ids[0]], {
      env: t.env,
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());

    // The wizard renders CredentialsStep with a header that names the run.
    await w.waitFor(/Push run run-def/, { timeout: 15000 });
    const screen = w.getScreen();
    expect(screen).toMatch(/Space ID:/);
    expect(screen).toMatch(/CMA Token:/);
  });

  // ── --modify (PTY): reaches the "Loading generated definitions" state ──
  //
  // With a valid seeded run but no pipeline.db entry, the modify flow
  // renders "Loading generated definitions..." then errors — but
  // reaching that state proves --modify routed correctly.
  it('--modify with a seeded run reaches the "Loading generated definitions" state', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { ids } = seedRuns(t.home, [{ id: 'run-mod' }]);

    const w = await spawnWizard(['import', '--modify', ids[0]], {
      env: t.env,
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());

    await w.waitFor(/Loading generated definitions/, { timeout: 15000 });
    // Without a seeded pipeline.db, the wizard errors — but --modify's
    // routing did fire, which is what we're asserting.
    const screen = w.getScreen();
    expect(screen).toMatch(/generated definitions/i);
  });

  // ── Bogus run id in the seeded file still surfaces a clean error ────────
  it('--push-from-run with a bogus id + seeded runs.json still returns the run-not-found error', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    // Seed a real run so the file exists — the flag references a
    // different id that doesn't match.
    seedRuns(t.home, [{ id: 'run-in-file' }]);

    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'not-in-file'],
      { env: t.env },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/Run not-in-file not found/);
  });
});
