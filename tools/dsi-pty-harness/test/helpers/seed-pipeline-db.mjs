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
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DB = resolve(HERE, '../../fixtures/pipeline-state/pipeline.db');
const FIXTURE_DB_WITH_PROPS = resolve(HERE, '../../fixtures/pipeline-state/pipeline-with-props.db');

/** The session id in the fixture DB whose raw_components have status='generated'. */
export const SEEDED_SESSION_ID = 'true-creek-c44b';

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
  return { dbPath, sessionId: SEEDED_SESSION_ID };
}
