/**
 * Tier 6 — Ctrl-C during an in-flight push.
 *
 * The mock EMA's /imports/apply handler is deliberately stalled: it
 * accepts the POST, holds the socket open, and never responds. The
 * wizard has already sent the request, so the CLI is blocked awaiting
 * completion. Ctrl-C must abort cleanly:
 *   - the process exits within a bounded window
 *   - the mock recorded exactly one apply POST and NO completion poll
 *     lands (the ephemeral operation shouldn't be re-queried after
 *     abort)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../src/harness.mjs';
import { startMockEma } from './helpers/mock-ema.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { seedRuns } from './helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from './helpers/seed-pipeline-db.mjs';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('Ctrl-C during in-flight push', () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()();
  });

  it('SIGINT aborts a stalled apply; process exits without completing the operation', async () => {
    const mock = await startMockEma();
    cleanups.push(() => mock.close());
    // Preview: one "new" component so the push flow proceeds past the
    // no-op short-circuit.
    mock.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          components: {
            new: [{ id: 'Button', name: 'Button' }],
            changed: [],
            unchanged: [],
            removed: [],
          },
          tokens: { new: [], changed: [], unchanged: [], removed: [] },
          taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
        }),
      );
    });
    // Stall apply — accept the connection but never write a response.
    // The socket stays open until the CLI is killed by Ctrl-C.
    mock.stub('POST', /imports\/apply$/, (req, res) => {
      // Intentionally do nothing. The mock request is already recorded
      // by the top-level handler before dispatch (see mock-ema.mjs L41),
      // so mock.requests[i].path === '/imports/apply' still lands.
    });

    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);
    const savePath = join(t.home, 'save');
    mkdirSync(savePath, { recursive: true });
    writeFileSync(join(savePath, 'tokens.json'), '{}\n');
    const projectPath = join(t.home, 'fake-project');
    mkdirSync(join(projectPath, '.contentful'), { recursive: true });
    writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    writeFileSync(
      join(t.home, '.config', 'experiences', 'credentials.json'),
      JSON.stringify({
        spaceId: 'sp1',
        environmentId: 'master',
        cmaToken: 'fake-token',
        host: mock.host,
      }),
    );
    seedRuns(t.home, [
      {
        id: 'run-stall',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath,
      },
    ]);

    const w = await spawnWizard(
      ['import', '--modify', 'run-stall', '--overwrite'],
      {
        env: { HOME: t.home, EDS_PIPELINE_DB_PATH: dbPath },
        cols: 200,
        rows: 60,
      },
    );
    cleanups.push(() => w.close());
    // Drive through the push-through-wizard sequence to the point where
    // /imports/apply gets fired (and stalls).
    await w.waitFor(/Button/, { timeout: 15000 });
    w.writeKey('A');
    await new Promise((r) => setTimeout(r, 1500));
    w.writeKey('F');
    await w.waitFor(/Save decisions and exit\?/, { timeout: 8000 });
    w.writeKey('y');
    await w.waitFor(/Save AND push/, { timeout: 8000 });
    w.writeKey('b');
    await w.waitFor(/Push to Contentful/, { timeout: 15000 });
    w.writeKey('enter');

    // Wait for the stalled apply POST to land on the mock, then SIGINT.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (mock.requests.some((r) => r.path.endsWith('/imports/apply'))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const applyBefore = mock.requests.filter((r) =>
      r.path.endsWith('/imports/apply'),
    );
    expect(applyBefore.length).toBe(1);

    const pid = w.term.pid;
    w.writeKey('ctrl-c');
    let exited = await waitForExit(pid, 5000);
    if (!exited) {
      w.writeKey('ctrl-c');
      exited = await waitForExit(pid, 3000);
    }
    expect(isProcessAlive(pid)).toBe(false);

    // No completion polls fired after the abort.
    const polls = mock.requests.filter((r) =>
      /\/imports\/apply\/[^/]+$/.test(r.path),
    );
    expect(polls.length).toBe(0);
  });
});
