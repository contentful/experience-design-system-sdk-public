/**
 * Copy the pre-baked pipeline.db fixture into a test's tmp HOME.
 *
 * `fixtures/pipeline-state/pipeline.db` was produced by running:
 *   experiences import --project react-minimal --skip-apply --print --out ...
 * against the stub agent. It contains a session (`true-creek-c44b`)
 * with 3 raw_components (Button, Card, Icon) all status='generated'
 * and at least one prop with `cdf_type` populated. That's enough for
 * loadCDFComponents() to return them.
 *
 * Wire it up:
 *   const t = makeTmpHome();
 *   const { dbPath, sessionId } = seedPipelineDb(t.home);
 *   const env = { ...t.env, EDS_PIPELINE_DB_PATH: dbPath };
 *
 * Then --modify against a runs.json seeded with `extractSessionId:
 * sessionId, generateSessionId: sessionId` will load real generated
 * definitions from the seeded db.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// PTY_DEBUG=1 dumps every source_path rewrite (before → after) and
// asserts the fixture components dir exists. Off by default. Use to
// diagnose fixture-path issues on another machine:
//
//   PTY_DEBUG=1 PTY_TESTS=1 pnpm --filter @contentful/dsi-pty-harness \
//     exec vitest run test/analyze/select.validation.test.mjs
const DEBUG = process.env.PTY_DEBUG === '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DB = resolve(HERE, '../../fixtures/pipeline-state/pipeline.db');
const FIXTURE_DB_WITH_PROPS = resolve(HERE, '../../fixtures/pipeline-state/pipeline-with-props.db');
const REACT_MINIMAL_COMPONENTS_DIR = resolve(
  HERE,
  '../../fixtures/projects/react-minimal/src/components',
);

/** The session id in the fixture DB whose raw_components have status='generated'. */
export const SEEDED_SESSION_ID = 'true-creek-c44b';

/**
 * Rewrite `raw_components.source_path` on the seeded DB to absolute paths
 * that resolve on the current machine.
 *
 * The fixture DBs were captured on the author's laptop, so the baked
 * `source_path` values were absolute paths under /Users/... that don't
 * exist on Linux CI. Any test that resolves those paths (notably
 * `analyze select`'s refine-session loader in `analyze/select/command.ts`)
 * fails with "Unable to access component source at ...".
 *
 * We rewrite each row to `<REACT_MINIMAL>/<basename>` — preserving the
 * component filename (Button.tsx, Card.tsx, Icon.tsx) but rooting the
 * path at the fixture's actual location on this machine.
 */
function rewriteSourcePaths(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    // The fixture DB is captured in WAL mode. If we write in WAL, our
    // updates go to a -wal sidecar file that the CLI's fresh open
    // doesn't necessarily see (DatabaseSync.close() doesn't guarantee
    // a checkpoint). Switch to DELETE mode on the copy so every write
    // is durable in the main .db file before we close.
    db.exec('PRAGMA journal_mode = DELETE');
    const rows = db
      .prepare('SELECT session_id, component_id, source, source_path FROM raw_components')
      .all();
    const update = db.prepare(
      'UPDATE raw_components SET source = ?, source_path = ? WHERE session_id = ? AND component_id = ?',
    );
    if (DEBUG) {
      process.stderr.write(
        `\n[seedPipelineDb] rewriting source_path in ${dbPath}\n` +
          `  target dir=${REACT_MINIMAL_COMPONENTS_DIR}\n` +
          `  target dir exists=${existsSync(REACT_MINIMAL_COMPONENTS_DIR)}\n` +
          `  rows found=${rows.length}\n`,
      );
    }
    for (const row of rows) {
      if (typeof row.source_path !== 'string') continue;
      const newPath = join(REACT_MINIMAL_COMPONENTS_DIR, basename(row.source_path));
      if (DEBUG) {
        process.stderr.write(
          `  ${row.session_id}/${row.component_id}:\n` +
            `    source_path: ${row.source_path}\n` +
            `    source:      ${row.source}\n` +
            `    → ${newPath}\n` +
            `    → exists=${existsSync(newPath)}\n`,
        );
      }
      update.run(newPath, newPath, row.session_id, row.component_id);
    }
  } finally {
    db.close();
  }
}

/**
 * Copy the fixture pipeline.db into <home>/.contentful/experience-design-system-cli/pipeline.db.
 * Returns the resolved path and the seeded session id.
 *
 * Pass `variant: 'with-props'` to seed the props-bearing variant — same
 * three components (Button, Card, Icon), same session id, but every
 * raw_prop has `cdf_type` and `cdf_category` populated so `loadCDFComponents`
 * returns non-empty `$properties`. Use this for FieldEditor per-field tests
 * that need real prop rows.
 */
export function seedPipelineDb(home, { variant = 'default' } = {}) {
  const dir = join(home, '.contentful', 'experience-design-system-cli');
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'pipeline.db');
  const src = variant === 'with-props' ? FIXTURE_DB_WITH_PROPS : FIXTURE_DB;
  copyFileSync(src, dbPath);
  rewriteSourcePaths(dbPath);
  return { dbPath, sessionId: SEEDED_SESSION_ID };
}
