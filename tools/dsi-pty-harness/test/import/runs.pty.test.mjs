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
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { seedRuns } from '../helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../helpers/seed-pipeline-db.mjs';

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
    // Seed a real pipeline.db + a tokens.json placeholder at the
    // recorded projectPath so the wizard's live-preview doesn't error
    // out before rendering CredentialsStep.
    const { dbPath } = seedPipelineDb(t.home);
    const savePath = join(t.home, 'save');
    mkdirSync(savePath, { recursive: true });
    writeFileSync(join(savePath, 'tokens.json'), '{}\n');
    const projectPath = join(t.home, 'fake-project');
    mkdirSync(join(projectPath, '.contentful'), { recursive: true });
    writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');
    const { ids } = seedRuns(t.home, [
      {
        id: 'run-def',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath,
      },
    ]);

    const w = await spawnWizard(['import', '--push-from-run', ids[0]], {
      env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath },
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

  // ── --modify (PTY): routes to the run's session ────────────────────────
  //
  // With a valid seeded run but no seeded pipeline.db, the modify flow
  // either (a) briefly renders "Loading generated definitions..." then
  // errors, or (b) exits synchronously with an error that references the
  // run's session id. Either outcome proves --modify routed the request
  // through replayRun to the recorded session.
  it('--modify with a seeded run routes into that run\'s session', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { ids } = seedRuns(t.home, [{ id: 'run-mod' }]);
    // The seeded RunRecord defaults `generateSessionId` to
    // `generate-sess-<index>` (see seed-runs.mjs). We assert the wizard
    // touched that specific session — anything from "Loading generated
    // definitions" to the terminal "session ... has no generated
    // components" error counts, since both prove routing worked.
    const expectedSessionId = 'generate-sess-0';

    const w = await spawnWizard(['import', '--modify', ids[0]], {
      env: t.env,
      cols: 200,
      rows: 60,
    });
    cleanups.push(() => w.close());

    // Poll the raw buffer manually instead of using w.waitFor: the wizard
    // may exit synchronously with the "no generated components" error
    // before Ink ever mounts, and waitFor treats an early exit as a
    // failure.
    const deadline = Date.now() + 15000;
    const matcher = new RegExp(
      `Loading generated definitions|${expectedSessionId}`,
    );
    let matched = false;
    while (Date.now() < deadline) {
      if (matcher.test(w.getScreen())) {
        matched = true;
        break;
      }
      if (w.isExited() && matcher.test(w.getScreen())) {
        matched = true;
        break;
      }
      if (w.isExited()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(matched).toBe(true);
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
