import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPipelineDb,
  storeRawComponents,
  storeCDFComponents,
  storeDTCGTokens,
  getOrCreateSession,
  createStep,
  updateStep,
  loadRawPropTokenPaths,
  loadRawComponents,
  loadCDFComponents,
  replaceRawTokenNamePaths,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');
const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures/generate');

const tempDirs: string[] = [];
async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const RAW: RawComponentDefinition[] = [
  {
    name: 'Card',
    source: 'src/Card.tsx',
    framework: 'react',
    props: [
      { name: 'bgColor', type: 'string', required: false, category: 'design' },
      { name: 'label', type: 'string', required: true, category: 'content' },
    ],
    slots: [],
  },
];

async function seedGeneratedSession(dbPath: string, withTokens: boolean): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, RAW);
  storeCDFComponents(db, sessionId, [
    {
      key: 'Card',
      entry: {
        $type: 'component',
        $properties: {
          bgColor: { $type: 'token', $category: 'design', '$token.kind': 'color' },
          label: { $type: 'string', $category: 'content' },
        },
      },
    },
  ]);
  if (withTokens) {
    storeDTCGTokens(
      db,
      sessionId,
      [],
      [
        { path: 'colors.surface.default', $type: 'color', $value: '#fff' },
        { path: 'colors.surface.raised', $type: 'color', $value: '#eee' },
      ],
    );
  }
  const stepId = createStep(db, sessionId, 'generate components', {});
  updateStep(db, stepId, 'complete', { sessionId });
  db.close();
  return sessionId;
}

async function seedGeneratedSessionWithoutStep(dbPath: string): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, RAW);
  storeCDFComponents(db, sessionId, [
    {
      key: 'Card',
      entry: {
        $type: 'component',
        $properties: {
          bgColor: { $type: 'token', $category: 'design', '$token.kind': 'color' },
          label: { $type: 'string', $category: 'content' },
        },
      },
    },
  ]);
  storeDTCGTokens(
    db,
    sessionId,
    [],
    [
      { path: 'colors.surface.default', $type: 'color', $value: '#fff' },
      { path: 'colors.surface.raised', $type: 'color', $value: '#eee' },
    ],
  );
  // Deliberately no createStep/updateStep call for 'generate components' — this
  // mirrors a real standalone run, since `generate components` never records
  // that step itself.
  db.close();
  return sessionId;
}

async function run(
  args: string[],
  opts: { dbPath: string; fakeAgentScript?: string },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const fakeBinDir = await createTempDir('fake-bin-');
  if (opts.fakeAgentScript) {
    await chmod(opts.fakeAgentScript, 0o755);
    await symlink(opts.fakeAgentScript, join(fakeBinDir, 'claude'));
  }
  const env = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH}`,
    EDS_PIPELINE_DB_PATH: opts.dbPath,
    DISABLE_ANALYTICS: '1',
  };
  return new Promise((res) => {
    execFile('node', [bin, ...args], { env }, (error, stdout, stderr) => {
      const code = error && 'code' in error ? (error.code as number) : 0;
      res({ stdout, stderr, code });
    });
  });
}

describe('map tokens command', () => {
  it('applies a valid map_token_prop suggestion end to end', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSession(dbPath, true);

    const { stdout, code } = await run(['map', 'tokens', '--session', sessionId, '--agent', 'claude'], {
      dbPath,
      fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs'),
    });

    expect(code).toBe(0);
    expect(stdout).toContain('map tokens complete');

    const db = openPipelineDb(dbPath);
    const componentId = loadRawComponents(db, sessionId)[0].component_id;
    const groups = loadRawPropTokenPaths(db, sessionId);
    expect(groups).toEqual([{ componentId, propName: 'bgColor', kind: 'allowed', paths: ['colors.surface.default'] }]);
    db.close();
  });

  it('normalizes an exact source-form token default before applying allowed paths', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSession(dbPath, true);
    const setupDb = openPipelineDb(dbPath);
    const componentId = loadRawComponents(setupDb, sessionId)[0].component_id;
    setupDb
      .prepare(`UPDATE raw_props SET default_value = ? WHERE session_id = ? AND component_id = ? AND name = 'bgColor'`)
      .run('tokens.surfaceDefault', sessionId, componentId);
    replaceRawTokenNamePaths(setupDb, sessionId, {
      'tokens.surfaceDefault': 'colors.surface.default',
    });
    setupDb.close();

    const { code } = await run(['map', 'tokens', '--session', sessionId, '--agent', 'claude'], {
      dbPath,
      fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs'),
    });

    expect(code).toBe(0);
    const db = openPipelineDb(dbPath);
    const [{ entry }] = loadCDFComponents(db, sessionId);
    expect(entry.$properties.bgColor?.$default).toBe('colors.surface.default');
    expect(entry.$properties.bgColor?.$default).not.toBe('#fff');
    expect(entry.$properties.bgColor?.['$token.allowed']).toEqual(['colors.surface.default']);
    db.close();
  });

  it('--print-prompt prints the prompt and exits without invoking an agent', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSession(dbPath, true);
    const setupDb = openPipelineDb(dbPath);
    const componentId = loadRawComponents(setupDb, sessionId)[0]!.component_id;
    setupDb
      .prepare(`UPDATE raw_props SET default_value = ? WHERE session_id = ? AND component_id = ? AND name = 'bgColor'`)
      .run('tokens.surfaceDefault', sessionId, componentId);
    replaceRawTokenNamePaths(setupDb, sessionId, {
      'tokens.surfaceDefault': 'colors.surface.default',
    });
    setupDb.close();

    const { stdout, code } = await run(
      ['map', 'tokens', '--session', sessionId, '--print-prompt', '--agent', 'claude'],
      { dbPath },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Token path index');
    const db = openPipelineDb(dbPath);
    const rawDefault = db
      .prepare(`SELECT default_value FROM raw_props WHERE session_id = ? AND component_id = ? AND name = 'bgColor'`)
      .get(sessionId, componentId) as { default_value: string };
    expect(rawDefault.default_value).toBe('tokens.surfaceDefault');
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM steps WHERE session_id = ? AND command = 'map tokens'`).get(sessionId),
    ).toEqual({ count: 0 });
    db.close();
  });

  it('exits 0 with a clear message and writes nothing when the session has no tokens', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSession(dbPath, false);

    const { stdout, code } = await run(['map', 'tokens', '--session', sessionId, '--agent', 'claude'], { dbPath });

    expect(code).toBe(0);
    expect(stdout).toContain('Nothing to map');

    const db = openPipelineDb(dbPath);
    expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
    db.close();
  });

  it('exits non-zero with an actionable message when the session has not run generate components', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    db.close();

    const { stderr, code } = await run(['map', 'tokens', '--session', sessionId, '--agent', 'claude'], { dbPath });

    expect(code).not.toBe(0);
    expect(stderr).toContain('generate components');
  });

  it('an explicit --session with generated CDF components succeeds even without a recorded generate components step', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSessionWithoutStep(dbPath);

    const { stdout, code } = await run(['map', 'tokens', '--session', sessionId, '--agent', 'claude'], {
      dbPath,
      fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs'),
    });

    expect(code).toBe(0);
    expect(stdout).toContain('map tokens complete');

    const db = openPipelineDb(dbPath);
    const componentId = loadRawComponents(db, sessionId)[0].component_id;
    const groups = loadRawPropTokenPaths(db, sessionId);
    expect(groups.find((g) => g.componentId === componentId && g.kind === 'allowed')?.paths).toEqual([
      'colors.surface.default',
    ]);
    db.close();
  });

  it('a cache hit skips the agent invocation and copies the prior mapping', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionA = await seedGeneratedSession(dbPath, true);

    const first = await run(['map', 'tokens', '--session', sessionA, '--agent', 'claude'], {
      dbPath,
      fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs'),
    });
    expect(first.code).toBe(0);

    const sessionB = await seedGeneratedSession(dbPath, true);
    // No fakeAgentScript this time — if the command tries to invoke the agent, `which claude` fails and it dies non-zero.
    const second = await run(['map', 'tokens', '--session', sessionB, '--agent', 'claude'], { dbPath });

    expect(second.code).toBe(0);
    expect(second.stdout).toContain('map tokens complete');

    const db = openPipelineDb(dbPath);
    const componentId = loadRawComponents(db, sessionB)[0].component_id;
    const groups = loadRawPropTokenPaths(db, sessionB);
    expect(groups.find((g) => g.componentId === componentId && g.kind === 'allowed')?.paths).toEqual([
      'colors.surface.default',
    ]);
    db.close();
  });

  it('does not cache a run that applies zero mappings, so a later session still invokes the agent', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionA = await seedGeneratedSession(dbPath, true);

    const first = await run(['map', 'tokens', '--session', sessionA, '--agent', 'claude'], {
      dbPath,
      fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-wrong-category.mjs'),
    });
    expect(first.code).toBe(0);

    const db = openPipelineDb(dbPath);
    const cacheRows = db
      .prepare(`SELECT * FROM generation_cache WHERE entity_type = 'token_mapping'`)
      .all();
    expect(cacheRows).toEqual([]);
    db.close();

    const sessionB = await seedGeneratedSession(dbPath, true);
    // Must supply a fakeAgentScript — if a (poisoned) cache hit short-circuited this run, `which claude`
    // would fail and the process would die non-zero, since no agent script is set up here.
    const second = await run(['map', 'tokens', '--session', sessionB, '--agent', 'claude'], {
      dbPath,
      fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs'),
    });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('map tokens complete');

    const db2 = openPipelineDb(dbPath);
    const componentId = loadRawComponents(db2, sessionB)[0].component_id;
    const groups = loadRawPropTokenPaths(db2, sessionB);
    expect(groups.find((g) => g.componentId === componentId && g.kind === 'allowed')?.paths).toEqual([
      'colors.surface.default',
    ]);
    db2.close();
  });

  it('records a step row with inputs and outputs', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSession(dbPath, true);

    await run(['map', 'tokens', '--session', sessionId, '--agent', 'claude'], {
      dbPath,
      fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs'),
    });

    const db = openPipelineDb(dbPath);
    const step = db
      .prepare(`SELECT command, status, inputs, outputs FROM steps WHERE session_id = ? AND command = 'map tokens'`)
      .get(sessionId) as { command: string; status: string; inputs: string; outputs: string } | undefined;
    expect(step?.status).toBe('complete');
    expect(JSON.parse(step?.inputs ?? '{}')).toHaveProperty('agent');
    expect(JSON.parse(step?.outputs ?? '{}')).toHaveProperty('applied');
    db.close();
  });
});
