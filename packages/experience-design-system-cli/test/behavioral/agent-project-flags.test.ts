/**
 * Behavioral assertions for --agent names and --project extraction.
 *
 * Verifies:
 * 1. analyze extract --project <path> scans source files and stores results
 * 2. All four documented agent names (claude, codex, opencode, cursor) are
 *    accepted by generate components, generate tokens, and analyze select-agent
 *    when combined with --dry-run (no binary required)
 * 3. import --project <path> runs the analyze extract step against that path
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Static fixture project — has a real Button.tsx with TypeScript props so
// the extractor can find at least one component.  Stub files (// stub X) are
// too minimal for the extractor to classify anything.
// ---------------------------------------------------------------------------
const REAL_PROJECT_DIR = resolve(import.meta.dirname, '../fixtures/analyze/project');

// ---------------------------------------------------------------------------
// Shared fixture (for --session lookups in dry-run tests)
// ---------------------------------------------------------------------------
let fixture: TestFixture;

// Temp dirs created inline — tracked here for cleanup
const extraTempDirs: string[] = [];

beforeAll(async () => {
  fixture = await createTestFixture();
});

afterAll(async () => {
  await fixture.cleanup();
  await Promise.all(extraTempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeFreshDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-proj-db-'));
  extraTempDirs.push(dir);
  return join(dir, 'pipeline.db');
}

// ---------------------------------------------------------------------------
// 1. analyze extract --project scans source files
// ---------------------------------------------------------------------------

describe('analyze extract --project scans source files', () => {
  it('--project triggers extraction and exits 0', async () => {
    const dbPath = await makeFreshDbPath();
    const { code } = await runCliWithEnv(
      ['analyze', 'extract', '--project', REAL_PROJECT_DIR],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
  });

  it('--project outputs a session ID on stdout', async () => {
    const dbPath = await makeFreshDbPath();
    const { stdout, code } = await runCliWithEnv(
      ['analyze', 'extract', '--project', REAL_PROJECT_DIR],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
    // Non-TTY mode writes "session=<id>" on stdout
    expect(stdout).toMatch(/^session=/m);
  });

  it('--project with a real TSX file finds at least one component', async () => {
    const dbPath = await makeFreshDbPath();
    const { stderr, code } = await runCliWithEnv(
      ['analyze', 'extract', '--project', REAL_PROJECT_DIR],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
    // Summary line on stderr reports the extracted count
    expect(stderr).toMatch(/Extracted \d+ component/);
    const match = /Extracted (\d+) component/.exec(stderr);
    expect(Number(match?.[1])).toBeGreaterThan(0);
  });

  it('--project is required — omitting it exits non-zero', async () => {
    const dbPath = await makeFreshDbPath();
    const { code, stderr } = await runCliWithEnv(['analyze', 'extract'], {
      EDS_PIPELINE_DB_PATH: dbPath,
      NODE_NO_WARNINGS: '1',
    });
    expect(code).not.toBe(0);
    // Commander emits "required option '--project <path>' not specified"
    expect(stderr).toContain('--project');
  });

  it('--project with --dir narrows extraction to the subdirectory', async () => {
    const dbPath = await makeFreshDbPath();
    const { code } = await runCliWithEnv(
      ['analyze', 'extract', '--project', REAL_PROJECT_DIR, '--dir', 'src'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
  });

  it('--project with a nonexistent directory exits non-zero', async () => {
    const dbPath = await makeFreshDbPath();
    const { code } = await runCliWithEnv(
      ['analyze', 'extract', '--project', '/tmp/nonexistent-experiences-dir-xyz-000'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      15000,
    );
    expect(code).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. --agent accepts all documented names (claude, codex, opencode, cursor)
// ---------------------------------------------------------------------------

describe('--agent accepts all documented agent names', () => {
  // All four names documented in the PR; --dry-run means no binary is needed.
  const agentNames = ['claude', 'codex', 'opencode', 'cursor'] as const;

  const baseEnv = () => ({
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    EDS_CREDENTIALS_PATH: join(fixture.dbPath.replace(/\/[^/]+$/, ''), 'no-credentials.json'),
    NODE_NO_WARNINGS: '1',
  });

  // ── generate components ──────────────────────────────────────────────────

  it.each(agentNames)('generate components --agent %s --dry-run exits 0', async (agent) => {
    const { code, stderr } = await runCliWithEnv(
      ['generate', 'components', '--agent', agent, '--session', fixture.sessionId, '--dry-run'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stderr).not.toContain('unknown agent');
  });

  it.each(agentNames)('generate components --agent %s produces a prompt on stdout', async (agent) => {
    const { stdout, code } = await runCliWithEnv(
      ['generate', 'components', '--agent', agent, '--session', fixture.sessionId, '--dry-run'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  // ── generate tokens ──────────────────────────────────────────────────────

  it.each(agentNames)('generate tokens --agent %s --dry-run exits 0', async (agent) => {
    const { code, stderr } = await runCliWithEnv(
      ['generate', 'tokens', '--agent', agent, '--raw-tokens', '/dev/null', '--dry-run'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stderr).not.toContain('unknown agent');
  });

  // ── analyze select-agent ─────────────────────────────────────────────────

  it.each(agentNames)('analyze select-agent --agent %s --dry-run exits 0', async (agent) => {
    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', agent, '--session', fixture.sessionId, '--dry-run'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stderr).not.toContain('unknown agent');
  });

  // ── invalid agent is rejected ────────────────────────────────────────────

  it('an unrecognised agent name exits non-zero', async () => {
    const { code, stderr } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'fake-agent-xyz', '--session', fixture.sessionId, '--dry-run'],
      baseEnv(),
    );
    expect(code).not.toBe(0);
    expect(stderr).toContain('no agent configured');
  });
});

// ---------------------------------------------------------------------------
// 3. import --project <path> runs extraction (not skipped)
// ---------------------------------------------------------------------------

describe('import --project runs analyze extract against the specified path', () => {
  it('exits 0 when project has real TSX components (with --skip-generate --skip-apply --select-all)', async () => {
    const dbPath = await makeFreshDbPath();
    const { code } = await runCliWithEnv(
      ['import', '--project', REAL_PROJECT_DIR, '--skip-generate', '--skip-apply', '--select-all'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
  });

  it('JSON output shows analyze extract step as complete (not skipped)', async () => {
    const dbPath = await makeFreshDbPath();
    const { stdout, code } = await runCliWithEnv(
      ['import', '--project', REAL_PROJECT_DIR, '--skip-generate', '--skip-apply', '--select-all'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { steps: Array<{ step: string; status: string }> };
    const analyzeStep = parsed.steps.find((s) => s.step === 'analyze extract');
    expect(analyzeStep).toBeDefined();
    expect(analyzeStep?.status).toBe('complete');
  });

  it('JSON output shows analyze extract found at least one component', async () => {
    const dbPath = await makeFreshDbPath();
    const { stdout, code } = await runCliWithEnv(
      ['import', '--project', REAL_PROJECT_DIR, '--skip-generate', '--skip-apply', '--select-all'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      steps: Array<{ step: string; status: string; detail?: { components?: number } }>;
    };
    const analyzeStep = parsed.steps.find((s) => s.step === 'analyze extract');
    expect(analyzeStep?.detail?.components).toBeGreaterThan(0);
  });

  it('import --project <nonexistent> fails at analyze extract step', async () => {
    const dbPath = await makeFreshDbPath();
    const { code } = await runCliWithEnv(
      [
        'import',
        '--project',
        '/tmp/nonexistent-experiences-dir-xyz-import-test',
        '--skip-generate',
        '--skip-apply',
        '--select-all',
      ],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).not.toBe(0);
  });

  it('JSON output has session and project fields', async () => {
    const dbPath = await makeFreshDbPath();
    const { stdout, code } = await runCliWithEnv(
      ['import', '--project', REAL_PROJECT_DIR, '--skip-generate', '--skip-apply', '--select-all'],
      { EDS_PIPELINE_DB_PATH: dbPath, NODE_NO_WARNINGS: '1' },
      30000,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(typeof parsed['session']).toBe('string');
    expect(typeof parsed['project']).toBe('string');
  });
});
