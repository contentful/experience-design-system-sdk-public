import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedPipelineDb, SEEDED_SESSION_ID } from './seed-pipeline-db.mjs';
import { seedRuns } from './seed-runs.mjs';

/**
 * Create an isolated HOME for a test.
 *
 * By default returns just `{ home, env, cleanup }` — a bare tmp directory
 * with HOME/XDG_CONFIG_HOME pointing at it, and nothing else. Tests that
 * exercise runs.json v1/v2 migration, malformed-file handling, or
 * "no prior runs" flows want this.
 *
 * Pass `{ seed: 'default' | 'with-props' }` to also seed a working
 * fixture:
 *   - pipeline.db copied under $HOME/.contentful/experience-design-system-cli/
 *   - runs.json with a single run `run-seeded` pointing at the seeded
 *     session, a savePath with a tokens.json placeholder, and a projectPath
 *     with a .contentful/tokens.json placeholder (the wizard's live-preview
 *     reads this on entry to final-review and errors "file not found" if
 *     it's absent)
 *   - `EDS_PIPELINE_DB_PATH` set on `env` so the wizard picks up the
 *     seeded db even if it doesn't honor $HOME for that lookup
 * Returned extras: `{ dbPath, savePath, projectPath, runId, sessionId }`.
 *
 * Use `--modify run-seeded` or `--push-from-run run-seeded` in tests
 * that need the wizard to route through a valid run without each test
 * having to re-seed the trio of files themselves.
 */
export function makeTmpHome({ seed } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'eds-pty-home-'));
  const env = { HOME: home, XDG_CONFIG_HOME: join(home, '.config') };
  const cleanup = () => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {}
  };
  if (!seed) return { home, env, cleanup };

  const { dbPath } = seedPipelineDb(home, { variant: seed === 'with-props' ? 'with-props' : 'default' });
  const savePath = join(home, 'save');
  mkdirSync(savePath, { recursive: true });
  writeFileSync(join(savePath, 'tokens.json'), '{}\n');
  const projectPath = join(home, 'fake-project');
  mkdirSync(join(projectPath, '.contentful'), { recursive: true });
  writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');
  const { ids } = seedRuns(home, [
    {
      id: 'run-seeded',
      extractSessionId: SEEDED_SESSION_ID,
      generateSessionId: SEEDED_SESSION_ID,
      savePath,
      projectPath,
    },
  ]);
  return {
    home,
    env: { ...env, EDS_PIPELINE_DB_PATH: dbPath },
    cleanup,
    dbPath,
    savePath,
    projectPath,
    runId: ids[0],
    sessionId: SEEDED_SESSION_ID,
  };
}
