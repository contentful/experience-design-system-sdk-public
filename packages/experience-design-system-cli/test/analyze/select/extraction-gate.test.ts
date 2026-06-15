import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../../src/session/db.js';
import { registerAnalyzeEditCommand } from '../../../src/analyze/select/command.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const reviewRoot = resolve(import.meta.dirname, '../../../../..');

async function run(
  args: string[],
  options: { artifactsRoot: string; dbPath: string },
): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = '';
  let stderr = '';
  const analyze = new Command('analyze');
  const program = new Command().name('experience-design-system-cli');
  program.addCommand(analyze);
  registerAnalyzeEditCommand(analyze);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalArtifactsDir = process.env.EDS_REVIEW_ARTIFACTS_DIR;
  const originalDbPath = process.env.EDS_PIPELINE_DB_PATH;

  program.configureOutput({
    writeOut: (v) => {
      stdout += v;
    },
    writeErr: (v) => {
      stderr += v;
    },
  });
  program.exitOverride();

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    process.env.EDS_REVIEW_ARTIFACTS_DIR = options.artifactsRoot;
    process.env.EDS_PIPELINE_DB_PATH = options.dbPath;
    await program.parseAsync(['node', 'experience-design-system-cli', ...args], { from: 'node' });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const exitCode = typeof error === 'object' && error && 'exitCode' in error ? Number(error.exitCode) : 1;
    return { stdout, stderr, code: exitCode };
  } finally {
    if (originalArtifactsDir === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    else process.env.EDS_REVIEW_ARTIFACTS_DIR = originalArtifactsDir;
    if (originalDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = originalDbPath;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

const validComponent: RawComponentDefinition = {
  name: 'GoodComponent',
  source: 'packages/experience-design-system-cli/test/fixtures/sample-components/Accordion.tsx',
  framework: 'react',
  props: [{ name: 'variant', type: 'string', required: false }],
  slots: [],
};

const invalidComponent: RawComponentDefinition = {
  name: 'BadComponent',
  source: 'packages/experience-design-system-cli/test/fixtures/sample-components/Accordion.tsx',
  framework: 'react',
  // Empty prop name → EMPTY_PROP_NAME (error severity). EMPTY_SLOT_NAME is a
  // warning since SP-2's renameEmptySlots auto-recovers it; it would not trip
  // the fail-loud gate.
  props: [{ name: '', type: 'string', required: false }],
  slots: [],
};

describe('extraction gate — --select-all fails loud; --exclude-invalid is the explicit bypass', () => {
  let tmpDir: string;
  let dbPath: string;
  let artifactsRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-gate-'));
    dbPath = join(tmpDir, 'pipeline.db');
    artifactsRoot = join(tmpDir, 'reviews');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function seedSession(components: RawComponentDefinition[]): Promise<string> {
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    storeRawComponents(db, sessionId, components);
    db.close();
    return sessionId;
  }

  it('select-all with no errors: accepts all components', async () => {
    const sessionId = await seedSession([validComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 1');
    expect(stderr).toContain('Rejected: 0');
  });

  it('select-all WITHOUT --exclude-invalid on errored components: exits non-zero with the gate failure message', async () => {
    const sessionId = await seedSession([validComponent, invalidComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
      { artifactsRoot, dbPath },
    );
    expect(code).not.toBe(0);
    expect(stderr).toContain('failed validation');
    expect(stderr).toContain('--exclude-invalid');
    expect(stderr).toContain('BadComponent');
    expect(stderr).toContain('EMPTY_PROP_NAME');
    // Gate must fire BEFORE any state mutation — no Accepted/Rejected counts.
    expect(stderr).not.toMatch(/Accepted:\s*\d+\s+Rejected:\s*\d+/);
  });

  it('select-all WITH --exclude-invalid: auto-rejects errored components and surfaces the warning', async () => {
    const sessionId = await seedSession([validComponent, invalidComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all', '--exclude-invalid'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/Warning:.*1 component/);
    expect(stderr).toContain('BadComponent');
    expect(stderr).toContain('EMPTY_PROP_NAME');
    expect(stderr).toContain('Accepted: 1');
    expect(stderr).toContain('Rejected: 1');
  });

  it('select-all WITH --exclude-invalid: only invalid components → exits 0 with all rejected', async () => {
    const sessionId = await seedSession([invalidComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all', '--exclude-invalid'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 0');
    expect(stderr).toContain('Rejected: 1');
  });

  it('select-all is non-destructive after PR-31 idempotency fix: re-running yields the same DB state', async () => {
    // Status-only flags (--select-all + --exclude-invalid, no --patch) must NOT
    // call storeRawComponents — that DELETEs and re-inserts, wiping rejected
    // rows. Re-running must produce identical behavior. The previous "after
    // select-all only valid components remain" test was checking the
    // destructive path; that's the bug, not the contract.
    const sessionId = await seedSession([validComponent, invalidComponent]);

    const args = [
      'analyze',
      'select',
      '--session',
      sessionId,
      '--project-root',
      reviewRoot,
      '--select-all',
      '--exclude-invalid',
    ];
    const first = await run(args, { artifactsRoot, dbPath });
    expect(first.code).toBe(0);
    expect(first.stderr).toContain('Accepted: 1');
    expect(first.stderr).toContain('Rejected: 1');

    // Both rows still in the DB after the first run.
    const db = openPipelineDb(dbPath);
    const namesAfterFirst = (
      db.prepare(`SELECT name FROM raw_components WHERE session_id = ?`).all(sessionId) as Array<{ name: string }>
    )
      .map((r) => r.name)
      .sort();
    db.close();
    expect(namesAfterFirst).toEqual(['BadComponent', 'GoodComponent']);

    // Re-run produces the same counts.
    const second = await run(args, { artifactsRoot, dbPath });
    expect(second.code).toBe(0);
    expect(second.stderr).toContain('Accepted: 1');
    expect(second.stderr).toContain('Rejected: 1');
  });
});
