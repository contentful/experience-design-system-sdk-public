/**
 * Deep behavioral assertions for 6 flags in the experiences CLI.
 *
 * These tests go beyond "flag accepted, exit 0" and verify that each flag
 * actually changes observable behavior.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, chmod, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import {
  openPipelineDb,
  getOrCreateSession,
  storeCDFComponents,
  storeRawComponents,
  loadRawComponents,
  storeCache,
  computeComponentInputHash,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Shared temp dir tracking — cleaned up in afterAll
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------------------
// Helpers for building isolated DB fixtures
// ---------------------------------------------------------------------------

const SINGLE_COMPONENT: RawComponentDefinition[] = [
  {
    name: 'FlagTestButton',
    source: 'src/FlagTestButton.tsx',
    framework: 'react',
    props: [{ name: 'label', type: 'string', required: true }],
    slots: [],
  },
];

async function makeFreshDb(components = SINGLE_COMPONENT): Promise<{ dbPath: string; sessionId: string }> {
  const dbDir = await createTempDir('flag-db-');
  const dbPath = join(dbDir, 'pipeline.db');
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, components);
  db.close();
  return { dbPath, sessionId };
}

// ---------------------------------------------------------------------------
// Helpers for writing fake agent scripts
// ---------------------------------------------------------------------------

/** Create a fake `claude` binary that emits a minimal valid set of tool calls. */
async function makeFakeAgent(
  extraLines: string[] = [],
  exitCode = 0,
): Promise<{ binDir: string; envPatch: Record<string, string> }> {
  const binDir = await createTempDir('fake-agent-');
  const script = join(binDir, 'claude');
  const lines = [
    '#!/usr/bin/env node',
    ...extraLines,
    'process.stdout.write(\'{"tool":"classify_component","description":"test"}\\n\');',
    'process.stdout.write(\'{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"label"}\\n\');',
    `process.exit(${exitCode});`,
  ];
  await writeFile(script, lines.join('\n'));
  await chmod(script, '755');
  return {
    binDir,
    envPatch: { PATH: `${binDir}:${process.env['PATH'] ?? ''}` },
  };
}

// ---------------------------------------------------------------------------
// 1. --verbose: verbose run shows agent prose; non-verbose hides it
// ---------------------------------------------------------------------------

describe('--verbose shows prose output from the agent', () => {
  it('verbose run includes agent prose text; non-verbose run suppresses it', async () => {
    // The fake agent emits a prose line (not a tool call) plus valid tool calls.
    // OutputFormatter forwards prose to stderr only when verbose=true.
    const PROSE_MARKER = 'FLAG_VERBOSE_PROBE_UNIQUE_STRING';

    const { envPatch } = await makeFakeAgent([
      // Prose line — should appear only in verbose mode
      `process.stdout.write("${PROSE_MARKER}\\n");`,
    ]);

    const { dbPath, sessionId } = await makeFreshDb();

    const agentEnv = {
      EDS_PIPELINE_DB_PATH: dbPath,
      NODE_NO_WARNINGS: '1',
      EDS_RETRY_BACKOFF_MS: '0',
      ...envPatch,
    };

    const withoutVerbose = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', sessionId],
      agentEnv,
    );
    expect(withoutVerbose.code).toBe(0);

    // Each run consumes the session's component results — use a fresh DB for the verbose run.
    const { dbPath: dbPath2, sessionId: sessionId2 } = await makeFreshDb();
    const agentEnv2 = { ...agentEnv, EDS_PIPELINE_DB_PATH: dbPath2 };

    const withVerbose = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', sessionId2, '--verbose'],
      agentEnv2,
    );
    expect(withVerbose.code).toBe(0);

    // Verbose mode must include the prose text; non-verbose must not
    expect(withVerbose.stderr).toContain(PROSE_MARKER);
    expect(withoutVerbose.stderr).not.toContain(PROSE_MARKER);

    // Verbose run produces strictly more output than non-verbose
    const verboseLen = withVerbose.stdout.length + withVerbose.stderr.length;
    const quietLen = withoutVerbose.stdout.length + withoutVerbose.stderr.length;
    expect(verboseLen).toBeGreaterThan(quietLen);
  });
});

// ---------------------------------------------------------------------------
// 2. --no-cache: bypasses the component cache and invokes the agent
// ---------------------------------------------------------------------------

describe('--no-cache bypasses cached component results', () => {
  it('without cache bypass a cache hit is used; with EDS_NO_CACHE=1 the agent is invoked', async () => {
    // Set up a fresh DB with raw components and a pre-seeded cache entry.
    const dbDir = await createTempDir('no-cache-db-');
    const dbPath = join(dbDir, 'pipeline.db');

    const db = openPipelineDb(dbPath);

    // Seed extract session
    const { sessionId: extractSession } = getOrCreateSession(db, 'new', undefined, {
      command: 'analyze extract',
    });
    storeRawComponents(db, extractSession, SINGLE_COMPONENT);

    // Seed a prior generate session as the cache source
    const { sessionId: priorSession } = getOrCreateSession(db, 'new', undefined, {
      command: 'generate components',
    });
    storeCDFComponents(db, priorSession, [
      {
        key: 'FlagTestButton',
        entry: {
          $type: 'component',
          $description: 'Cached version',
          $properties: {
            label: { $type: 'string', $category: 'content', $required: true },
          },
        },
      },
    ]);

    // Write a cache record for the component's input hash
    const loadedComponents = loadRawComponents(db, extractSession);
    const component = loadedComponents[0]!;
    const inputHash = computeComponentInputHash(component);
    storeCache(db, inputHash, 'component', component.component_id, priorSession, false);
    db.close();

    // Fake agent: emits valid tool calls so the run succeeds when cache is bypassed
    const { envPatch } = await makeFakeAgent();

    const baseRunEnv = {
      EDS_PIPELINE_DB_PATH: dbPath,
      NODE_NO_WARNINGS: '1',
      EDS_RETRY_BACKOFF_MS: '0',
      ...envPatch,
    };

    // Without cache bypass: should use the cache (agent is NOT invoked, "cached" in stderr)
    const withCache = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', extractSession],
      baseRunEnv,
    );
    expect(withCache.code).toBe(0);
    expect(withCache.stderr).toContain('cached');
    // Summary shows all cached, none generated
    expect(withCache.stderr).toContain('1 cached');

    // With EDS_NO_CACHE=1 env var: skips cache, agent IS invoked
    const withNoCacheEnv = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', extractSession],
      { ...baseRunEnv, EDS_NO_CACHE: '1' },
    );
    expect(withNoCacheEnv.code).toBe(0);
    expect(withNoCacheEnv.stderr).toContain('1/1 components');
    expect(withNoCacheEnv.stderr).not.toContain('cached)');
  });

  it('--no-cache CLI flag bypasses cache and invokes the agent', async () => {
    // Same setup as above but using the --no-cache flag instead of env var
    const dbDir = await createTempDir('no-cache-flag-db-');
    const dbPath = join(dbDir, 'pipeline.db');

    const db = openPipelineDb(dbPath);
    const { sessionId: extractSession } = getOrCreateSession(db, 'new', undefined, {
      command: 'analyze extract',
    });
    storeRawComponents(db, extractSession, SINGLE_COMPONENT);

    const { sessionId: priorSession } = getOrCreateSession(db, 'new', undefined, {
      command: 'generate components',
    });
    storeCDFComponents(db, priorSession, [
      {
        key: 'FlagTestButton',
        entry: {
          $type: 'component',
          $description: 'Cached version',
          $properties: {
            label: { $type: 'string', $category: 'content', $required: true },
          },
        },
      },
    ]);

    const loadedComponents = loadRawComponents(db, extractSession);
    const component = loadedComponents[0]!;
    const inputHash = computeComponentInputHash(component);
    storeCache(db, inputHash, 'component', component.component_id, priorSession, false);
    db.close();

    const { envPatch } = await makeFakeAgent();

    // With --no-cache flag: agent IS invoked (cache bypassed)
    const result = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', extractSession, '--no-cache'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1', EDS_RETRY_BACKOFF_MS: '0', ...envPatch },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('1/1 components');
    expect(result.stderr).not.toContain('cached)');
  });
});

// ---------------------------------------------------------------------------
// 3. --model: model name is forwarded to the agent binary
// ---------------------------------------------------------------------------

describe('--model name is forwarded to the agent binary as a CLI argument', () => {
  it('agent receives the model name as --model <value> in its argv', async () => {
    const MODEL_NAME = 'my-custom-test-model-xyz-99';

    // Fake agent writes its argv to a known temp file so we can assert outside the CLI's stdout.
    const argsCapturePath = join(await createTempDir('model-args-'), 'agent-args.json');

    const binDir = await createTempDir('model-agent-');
    const script = join(binDir, 'claude');
    await writeFile(
      script,
      [
        '#!/usr/bin/env node',
        // Write argv to the capture file before emitting tool calls
        `const fs = require('fs');`,
        `fs.writeFileSync(${JSON.stringify(argsCapturePath)}, JSON.stringify(process.argv));`,
        'process.stdout.write(\'{"tool":"classify_component","description":"model test"}\\n\');',
        'process.stdout.write(\'{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"label"}\\n\');',
        'process.exit(0);',
      ].join('\n'),
    );
    await chmod(script, '755');

    const { dbPath, sessionId } = await makeFreshDb();

    const result = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', sessionId, '--model', MODEL_NAME],
      {
        EDS_PIPELINE_DB_PATH: dbPath,
        NODE_NO_WARNINGS: '1',
        PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
      },
    );

    expect(result.code).toBe(0);

    // The agent should have written its argv to the capture file
    const capturedRaw = await readFile(argsCapturePath, 'utf8');
    const capturedArgv = JSON.parse(capturedRaw) as string[];

    // Verify --model and the model name appear in argv
    const modelIdx = capturedArgv.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(capturedArgv[modelIdx + 1]).toBe(MODEL_NAME);
  });

  it('--dry-run prompt is the same with and without --model (model is not embedded in prompt text)', async () => {
    // The model flag controls which AI binary/version is invoked — it is NOT embedded in the
    // prompt text. Both dry-run outputs should be identical.
    const { dbPath, sessionId } = await makeFreshDb();
    const env = { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' };

    const withModel = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', sessionId, '--dry-run', '--model', 'some-model'],
      env,
    );
    expect(withModel.code).toBe(0);

    const withoutModel = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', sessionId, '--dry-run'],
      env,
    );
    expect(withoutModel.code).toBe(0);

    expect(withModel.stdout).toBe(withoutModel.stdout);
  });
});

// ---------------------------------------------------------------------------
// 4. --token-map: file content is embedded in the dry-run prompt
// ---------------------------------------------------------------------------

describe('--token-map file content is embedded in the generated prompt', () => {
  it('with --dry-run, the token-map JSON content appears inline in the prompt', async () => {
    const UNIQUE_TOKEN_KEY = 'buttonColorPrimaryMarkerXyz9978';
    const tokenMapDir = await createTempDir('tmap-');
    const tokenMapPath = join(tokenMapDir, 'token-map.json');
    await writeFile(tokenMapPath, JSON.stringify({ button: { color: UNIQUE_TOKEN_KEY } }, null, 2), 'utf8');

    const { dbPath, sessionId } = await makeFreshDb();

    const result = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', sessionId, '--dry-run', '--token-map', tokenMapPath],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
    );

    expect(result.code).toBe(0);
    // The token map section header (only present when --token-map is supplied)
    expect(result.stdout).toContain('Token-name sidecar (raw name');
    // The unique content from the file
    expect(result.stdout).toContain(UNIQUE_TOKEN_KEY);
  });

  it('without --token-map, the "Token-name sidecar" preamble section is absent', async () => {
    const { dbPath, sessionId } = await makeFreshDb();

    const result = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', sessionId, '--dry-run'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
    );

    expect(result.code).toBe(0);
    // The preamble-level header "Token-name sidecar (raw name → DTCG path):" must be absent.
    // (The skill file body contains different token-map references, but not this specific header.)
    expect(result.stdout).not.toContain('Token-name sidecar (raw name');
  });
});

// ---------------------------------------------------------------------------
// 5. --out: print components writes a JSON file to disk
// ---------------------------------------------------------------------------

describe('--out writes generated components to a JSON file on disk', () => {
  it('creates the specified file and writes component data into it', async () => {
    const cdfDir = await createTempDir('out-cdf-db-');
    const cdfDbPath = join(cdfDir, 'pipeline.db');

    const db = openPipelineDb(cdfDbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, {
      command: 'generate components',
    });
    storeCDFComponents(db, sessionId, [
      {
        key: 'OutTestWidget',
        entry: {
          $type: 'component',
          $description: 'A test widget for --out flag verification',
          $properties: {
            title: { $type: 'string', $category: 'content', $required: true },
          },
        },
      },
    ]);
    db.close();

    const outDir = await createTempDir('out-dest-');
    const outPath = join(outDir, 'components-out.json');

    const result = await runCliWithEnv(['print', 'components', '--session', sessionId, '--out', outPath], {
      EDS_PIPELINE_DB_PATH: cdfDbPath,
      NODE_NO_WARNINGS: '1',
    });

    expect(result.code).toBe(0);

    // The file must have been created on disk
    const fileStat = await stat(outPath);
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.size).toBeGreaterThan(0);

    // The file must contain the component key in the written JSON
    const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;
    expect(written['OutTestWidget']).toBeDefined();
  });

  it('a specific --out path writes to that exact location, not to the default', async () => {
    // `print components` has a default --out of `components.json` in cwd. When an explicit path
    // is given, the file must land at that path, not the default. This verifies --out actually
    // overrides the default rather than being silently ignored.
    const cdfDir = await createTempDir('out-override-db-');
    const cdfDbPath = join(cdfDir, 'pipeline.db');

    const db = openPipelineDb(cdfDbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, {
      command: 'generate components',
    });
    storeCDFComponents(db, sessionId, [
      {
        key: 'OverrideWidget',
        entry: {
          $type: 'component',
          $description: 'Widget for out-override test',
          $properties: {
            label: { $type: 'string', $category: 'content', $required: false },
          },
        },
      },
    ]);
    db.close();

    const specificOutDir = await createTempDir('out-override-dest-');
    const specificOutPath = join(specificOutDir, 'my-specific-output.json');

    const result = await runCliWithEnv(['print', 'components', '--session', sessionId, '--out', specificOutPath], {
      EDS_PIPELINE_DB_PATH: cdfDbPath,
      NODE_NO_WARNINGS: '1',
    });

    expect(result.code).toBe(0);

    // The specific path must exist and contain the expected component
    const fileStat = await stat(specificOutPath);
    expect(fileStat.isFile()).toBe(true);

    const written = JSON.parse(await readFile(specificOutPath, 'utf8')) as Record<string, unknown>;
    expect(written['OverrideWidget']).toBeDefined();

    // The status message confirms the specific filename was used
    expect(result.stdout).toContain('my-specific-output.json');
  });
});

// ---------------------------------------------------------------------------
// 6. --viewports: path is accepted and forwarded (not validated until apply)
// ---------------------------------------------------------------------------

describe('--viewports is accepted and forwarded to the pipeline', () => {
  it('accepts a valid viewports JSON file path and completes without error', async () => {
    // Use a prefix that does NOT contain "viewports" to avoid false positives in stderr checks.
    const vpDir = await createTempDir('vp-valid-');
    const vpFile = join(vpDir, 'vp.json');
    await writeFile(
      vpFile,
      JSON.stringify([
        { id: 'desktop', query: '(min-width: 1024px)', displayName: 'Desktop', previewSize: '100%' },
        { id: 'mobile', query: '*', displayName: 'Mobile', previewSize: '375px' },
      ]),
      'utf8',
    );

    const projDir = await createTempDir('vp-proj-');
    const dbDir = await createTempDir('vp-db-');
    const dbPath = join(dbDir, 'pipeline.db');

    const result = await runCliWithEnv(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', projDir, '--viewports', vpFile],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("unknown option '--viewports'");
    // All steps skipped — pipeline should report all as skipped
    const output = JSON.parse(result.stdout) as { steps: Array<{ status: string }> };
    expect(output.steps.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('with --skip-apply, a nonexistent viewports path does not cause an error', async () => {
    // The import command does not validate the viewports path itself —
    // it is only passed to apply push (which is skipped here).
    const projDir = await createTempDir('vp-nofile-proj-');
    const dbDir = await createTempDir('vp-nofile-db-');
    const dbPath = join(dbDir, 'pipeline.db');

    const result = await runCliWithEnv(
      [
        'import',
        '--skip-analyze',
        '--skip-generate',
        '--skip-apply',
        '--project',
        projDir,
        '--viewports',
        '/nonexistent/path/does-not-exist.json',
      ],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
    );

    // File is not read at this stage — no error expected
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("unknown option '--viewports'");
  });
});
