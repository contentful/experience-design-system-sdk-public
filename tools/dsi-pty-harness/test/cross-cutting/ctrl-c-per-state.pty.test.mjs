/**
 * Tier 6 — Ctrl-C at every meaningful wizard state.
 *
 * The welcome-state Ctrl-C case is already covered by
 * `03-ctrl-c-exits.pty.test.mjs`. This file extends coverage to:
 *   - Design tokens step (tokens picker prompt)
 *   - Scope-gate
 *   - Final-review (via --modify)
 *
 * Each test asserts the child process exits within a bounded window.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_MINIMAL } from '../helpers/fixtures.mjs';
import { seedRuns } from '../helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../helpers/seed-pipeline-db.mjs';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('Ctrl-C at each wizard state', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('exits cleanly from the Design tokens step', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--no-push'],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    const pid = w.term.pid;
    w.writeKey('ctrl-c');
    const exited = await waitForExit(pid, 5000);
    if (!exited) {
      w.writeKey('ctrl-c');
      await waitForExit(pid, 2000);
    }
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('exits cleanly from the scope-gate', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--no-push', '--no-auto-filter'],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());
    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');
    await w.waitFor(/Components \(3\)/, { timeout: 20000 });

    const pid = w.term.pid;
    w.writeKey('ctrl-c');
    const exited = await waitForExit(pid, 5000);
    if (!exited) {
      w.writeKey('ctrl-c');
      await waitForExit(pid, 2000);
    }
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('exits cleanly from the final-review step', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);
    const savePath = join(t.home, 'save');
    mkdirSync(savePath, { recursive: true });
    writeFileSync(join(savePath, 'tokens.json'), '{}\n');
    seedRuns(t.home, [
      {
        id: 'run-ctrlc',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath: join(t.home, 'fake-project'),
      },
    ]);
    const w = await spawnWizard(
      ['import', '--modify', 'run-ctrlc', '--no-push'],
      {
        env: { HOME: t.home, EDS_PIPELINE_DB_PATH: dbPath },
        cols: 200,
        rows: 60,
      },
    );
    cleanups.push(() => w.close());
    await w.waitFor(/Button/, { timeout: 15000 });
    await w.waitFor(/FIELDS/, { timeout: 5000 });

    const pid = w.term.pid;
    w.writeKey('ctrl-c');
    const exited = await waitForExit(pid, 5000);
    if (!exited) {
      w.writeKey('ctrl-c');
      await waitForExit(pid, 2000);
    }
    expect(isProcessAlive(pid)).toBe(false);
  });
});
