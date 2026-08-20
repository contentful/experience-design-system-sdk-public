import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgent, parseMapTokenPropToolCallLines } from '@contentful/experience-design-system-generation';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  storeCDFComponents,
  storeDTCGTokens,
  loadRawPropTokenPaths,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';
import { applyMapTokenPropCalls } from '../../src/map-tokens/apply.js';

// No live LLM in CI — each fixture is a plain node script standing in for an agent binary.
const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures/generate');

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

function seedSession(db: Parameters<typeof storeRawComponents>[0], sessionId: string): void {
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
      { path: 'colors.brand.primary', $type: 'color', $value: '#00f' },
    ],
  );
}

const tempDirs: string[] = [];
const savedBinaryOverride = process.env.EDS_AGENT_BINARY_CLAUDE;

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pipeline-db-map-tokens-fixtures-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  await run(dbPath);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  if (savedBinaryOverride === undefined) delete process.env.EDS_AGENT_BINARY_CLAUDE;
  else process.env.EDS_AGENT_BINARY_CLAUDE = savedBinaryOverride;
});

async function runFixtureAgent(fixtureName: string): Promise<string> {
  const fixturePath = join(FIXTURES_DIR, fixtureName);
  await chmod(fixturePath, 0o755);
  const result = await runAgent({
    agent: 'claude',
    prompt: 'map tokens',
    timeoutMs: 5000,
    model: 'unused',
  });
  return result.stdout;
}

describe('map_token_prop — fake-agent fixtures through the real parse → apply seam', () => {
  it('valid fixture: parses and persists the mapping', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = join(FIXTURES_DIR, 'fake-agent-map-tokens-valid.mjs');
    const stdout = await runFixtureAgent('fake-agent-map-tokens-valid.mjs');
    const { calls, warnings: parseWarnings } = parseMapTokenPropToolCallLines(stdout);
    expect(parseWarnings).toHaveLength(0);
    expect(calls).toHaveLength(1);

    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(db, sessionId, calls, parseWarnings);
      expect(result.applied).toBe(1);
      expect(result.warnings).toHaveLength(0);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        expect.objectContaining({ propName: 'bgColor', kind: 'allowed', paths: ['colors.surface.default'] }),
        expect.objectContaining({
          propName: 'bgColor',
          kind: 'set',
          paths: ['colors.surface.default', 'colors.surface.raised'],
        }),
      ]);
      db.close();
    });
  });

  it('hallucinated-path fixture: drops the invented path but keeps the real one', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = join(FIXTURES_DIR, 'fake-agent-map-tokens-hallucinated-path.mjs');
    const stdout = await runFixtureAgent('fake-agent-map-tokens-hallucinated-path.mjs');
    const { calls, warnings: parseWarnings } = parseMapTokenPropToolCallLines(stdout);
    expect(calls).toHaveLength(1);

    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(db, sessionId, calls, parseWarnings);
      expect(result.applied).toBe(1);
      expect(result.warnings.some((w) => w.includes('colors.invented.path'))).toBe(true);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([
        expect.objectContaining({ propName: 'bgColor', kind: 'set', paths: ['colors.surface.default'] }),
      ]);
      db.close();
    });
  });

  it('non-subset fixture: parser rejects the call before it reaches the DB', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = join(FIXTURES_DIR, 'fake-agent-map-tokens-non-subset.mjs');
    const stdout = await runFixtureAgent('fake-agent-map-tokens-non-subset.mjs');
    const { calls, warnings: parseWarnings } = parseMapTokenPropToolCallLines(stdout);
    expect(calls).toHaveLength(0);
    expect(parseWarnings[0]).toMatch(/not a subset/);

    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(db, sessionId, calls, parseWarnings);
      expect(result.applied).toBe(0);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('wrong-category fixture: apply rejects the call and persists nothing', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = join(FIXTURES_DIR, 'fake-agent-map-tokens-wrong-category.mjs');
    const stdout = await runFixtureAgent('fake-agent-map-tokens-wrong-category.mjs');
    const { calls, warnings: parseWarnings } = parseMapTokenPropToolCallLines(stdout);
    expect(calls).toHaveLength(1);

    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(db, sessionId, calls, parseWarnings);
      expect(result.applied).toBe(0);
      expect(result.warnings[0]).toMatch(/not a design-category token prop/);
      expect(loadRawPropTokenPaths(db, sessionId)).toEqual([]);
      db.close();
    });
  });

  it('malformed fixture: skips the bad line, still applies the valid one', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = join(FIXTURES_DIR, 'fake-agent-map-tokens-malformed.mjs');
    const stdout = await runFixtureAgent('fake-agent-map-tokens-malformed.mjs');
    const { calls, warnings: parseWarnings } = parseMapTokenPropToolCallLines(stdout);
    expect(calls).toHaveLength(1);
    expect(parseWarnings[0]).toMatch(/unparseable line/);

    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      seedSession(db, sessionId);

      const result = applyMapTokenPropCalls(db, sessionId, calls, parseWarnings);
      expect(result.applied).toBe(1);
      expect(result.warnings).toEqual(parseWarnings);
      db.close();
    });
  });
});
