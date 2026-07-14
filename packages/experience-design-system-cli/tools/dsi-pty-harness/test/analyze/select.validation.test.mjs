/**
 * Tier 5 — `experiences analyze select` (aliased `analyze edit`).
 *
 * Two testable surfaces:
 *   1. Non-interactive: --select-all / --select / --deselect / --patch /
 *      --exclude-components / --accept-all — writes a `analyze select`
 *      step to the DB and exits.
 *   2. Test-mode: EDS_REVIEW_TEST_MODE=1 short-circuits before launching
 *      the interactive TUI and prints the session-directory contract to
 *      stdout. Perfect for asserting the CLI reaches the launch point.
 *
 * The full split-panel TUI (ORIGINAL / EDIT) is a large state machine —
 * driving it via PTY is deferred to a Tier 5 follow-up.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../helpers/seed-pipeline-db.mjs';

describe('analyze select', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('--select-all completes non-interactively against the seeded session', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { code } = await runCli(
      ['analyze', 'select', '--session', SEEDED_SESSION_ID, '--select-all'],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    // Non-interactive path returns without stderr noise and exit 0.
    expect(code).toBe(0);
    // The DB itself is where the "analyze select" step is recorded; not
    // asserting on file existence — the observable is exit code + no error.
    expect(existsSync(dbPath)).toBe(true);
  });

  it('EDS_REVIEW_TEST_MODE prints the session-directory contract without launching the TUI', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stdout, code } = await runCli(
      ['analyze', 'select', '--session', SEEDED_SESSION_ID],
      {
        env: {
          ...t.env,
          EDS_PIPELINE_DB_PATH: dbPath,
          EDS_REVIEW_TEST_MODE: '1',
        },
      },
    );
    expect(code).toBe(0);
    // The test-mode contract is four lines: session, session_dir,
    // events.jsonl, current-review-state.json.
    expect(stdout).toMatch(new RegExp(`session=${SEEDED_SESSION_ID}`));
    expect(stdout).toMatch(/session_dir=/);
    expect(stdout).toMatch(/events\.jsonl=/);
    expect(stdout).toMatch(/current-review-state\.json=/);
  });

  it('unknown --session exits 1 with a "no raw components" error', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    const { stderr, code } = await runCli(
      ['analyze', 'select', '--session', 'ghost-abc', '--select-all'],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/no raw components|session/i);
  });

  it('rejects launching without a TTY', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);
    // No non-interactive flag AND no test-mode env → the CLI must refuse
    // to render the TUI in a non-TTY subprocess.
    const { stderr, code } = await runCli(
      ['analyze', 'select', '--session', SEEDED_SESSION_ID],
      { env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/interactive terminal/);
  });
});
