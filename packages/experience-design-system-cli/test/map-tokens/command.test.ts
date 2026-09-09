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
  loadRawComponents,
  loadRawTokenNamePaths,
  loadCDFComponents,
  replaceRawTokenNamePaths,
} from '../../src/session/db.js';
import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../src/types.js';

/** Reads a prop's stored token-allowed paths directly, in position order. */
function readTokenPaths(db: DatabaseSync, sessionId: string, componentId: string, propName: string): string[] {
  return (
    db
      .prepare(
        `SELECT path FROM raw_prop_token_paths
         WHERE session_id = ? AND component_id = ? AND prop_name = ?
         ORDER BY position`,
      )
      .all(sessionId, componentId, propName) as Array<{ path: string }>
  ).map((r) => r.path);
}

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

async function seedGeneratedSessionWithAliasDefault(dbPath: string): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      ...RAW[0]!,
      props: [
        {
          name: 'bgColor',
          type: 'string',
          required: false,
          category: 'design',
          defaultValue: '4px',
          tokenReference: 'tokens.surfaceDefault',
        },
        { name: 'label', type: 'string', required: true, category: 'content' },
      ],
    },
  ]);
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
  storeDTCGTokens(db, sessionId, [], [
    { path: 'colors.surface.surface-default', $type: 'color', $value: '#fff' },
    { path: 'colors.surface.default', $type: 'color', $value: '#fafafa' },
    { path: 'colors.surface.raised', $type: 'color', $value: '#eee' },
  ]);
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
    expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.surface.default']);
    db.close();
  });

  it('--print-prompt prints the prompt and exits without invoking an agent', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSession(dbPath, true);

    const { stdout, code } = await run(
      ['map', 'tokens', '--session', sessionId, '--print-prompt', '--agent', 'claude'],
      { dbPath },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Token path index');
  });

  it('resolves a token reference before --print-prompt without replacing the extracted literal default', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSessionWithAliasDefault(dbPath);

    const { code } = await run(['map', 'tokens', '--session', sessionId, '--print-prompt', '--agent', 'claude'], {
      dbPath,
    });
    expect(code).toBe(0);

    const db = openPipelineDb(dbPath);
    expect(loadRawTokenNamePaths(db, sessionId)).toEqual({
      'tokens.surfaceDefault': 'colors.surface.surface-default',
    });
    expect(loadRawComponents(db, sessionId)[0]?.props[0]?.defaultValue).toBe('4px');
    expect(loadRawComponents(db, sessionId)[0]?.props[0]?.tokenReference).toBe('tokens.surfaceDefault');
    expect(loadCDFComponents(db, sessionId)[0]?.entry.$properties.bgColor?.$default).toBe(
      'colors.surface.surface-default',
    );
    db.close();
  });

  it('retains a conflicting manual default mapping and reports the automatic conflict', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionId = await seedGeneratedSessionWithAliasDefault(dbPath);
    const db = openPipelineDb(dbPath);
    replaceRawTokenNamePaths(db, sessionId, { 'tokens.surfaceDefault': 'colors.surface.default' }, 'manual');
    db.close();

    const { code, stderr } = await run(['map', 'tokens', '--session', sessionId, '--print-prompt', '--agent', 'claude'], {
      dbPath,
    });
    expect(code).toBe(0);
    expect(stderr).toContain("automatically resolves to 'colors.surface.surface-default'");
    expect(stderr).toContain("manual mapping 'colors.surface.default' is retained");

    const reopened = openPipelineDb(dbPath);
    expect(loadRawTokenNamePaths(reopened, sessionId)).toEqual({
      'tokens.surfaceDefault': 'colors.surface.default',
    });
    expect(loadCDFComponents(reopened, sessionId)[0]?.entry.$properties.bgColor?.$default).toBe('colors.surface.default');
    reopened.close();
  });

  it('retains resolved defaults when a cached allowed-list mapping is reused', async () => {
    const dbDir = await createTempDir('map-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sessionA = await seedGeneratedSessionWithAliasDefault(dbPath);
    expect(
      (await run(['map', 'tokens', '--session', sessionA, '--agent', 'claude'], {
        dbPath,
        fakeAgentScript: join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs'),
      })).code,
    ).toBe(0);

    const sessionB = await seedGeneratedSessionWithAliasDefault(dbPath);
    expect((await run(['map', 'tokens', '--session', sessionB, '--agent', 'claude'], { dbPath })).code).toBe(0);

    const db = openPipelineDb(dbPath);
    expect(loadRawTokenNamePaths(db, sessionB)).toEqual({
      'tokens.surfaceDefault': 'colors.surface.surface-default',
    });
    expect(loadRawComponents(db, sessionB)[0]?.props[0]?.defaultValue).toBe('4px');
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
    const count = (
      db.prepare(`SELECT COUNT(*) AS count FROM raw_prop_token_paths WHERE session_id = ?`).get(sessionId) as {
        count: number;
      }
    ).count;
    expect(count).toBe(0);
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
    expect(readTokenPaths(db, sessionId, componentId, 'bgColor')).toEqual(['colors.surface.default']);
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
    expect(readTokenPaths(db, sessionB, componentId, 'bgColor')).toEqual(['colors.surface.default']);
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
    expect(readTokenPaths(db2, sessionB, componentId, 'bgColor')).toEqual(['colors.surface.default']);
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
