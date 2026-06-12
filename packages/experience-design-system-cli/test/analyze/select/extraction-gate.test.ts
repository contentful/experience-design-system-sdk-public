import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  props: [],
  slots: [{ name: '', isDefault: false }],
};

describe('extraction gate — --select-all never silently accepts error-severity components', () => {
  let tmpDir: string;
  let dbPath: string;
  let artifactsRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-gate-'));
    dbPath = join(tmpDir, 'pipeline.db');
    artifactsRoot = join(tmpDir, 'reviews');
    await writeFile(join(tmpDir, 'GoodComponent.tsx'), '// valid\n');
    await writeFile(join(tmpDir, 'BadComponent.tsx'), '// invalid\n');
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

  it('select-all with errors: auto-rejects errored components', async () => {
    const sessionId = await seedSession([validComponent, invalidComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 1');
    expect(stderr).toContain('Rejected: 1');
    expect(stderr).toContain('BadComponent');
    expect(stderr).toContain('EMPTY_SLOT_NAME');
  });

  it('select-all with --exclude-invalid: same result as without (already always excludes)', async () => {
    const sessionId = await seedSession([validComponent, invalidComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all', '--exclude-invalid'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 1');
    expect(stderr).toContain('Rejected: 1');
  });

  it('rejected count is reported in stderr for orchestrator logging', async () => {
    const sessionId = await seedSession([validComponent, invalidComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/Warning:.*1 component/);
    expect(stderr).toContain('Accepted: 1');
    expect(stderr).toContain('Rejected: 1');
  });

  it('select-all with only invalid components: all rejected, accepted count is 0', async () => {
    const sessionId = await seedSession([invalidComponent]);
    const { stderr, code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 0');
    expect(stderr).toContain('Rejected: 1');
  });

  it('end-to-end: after select-all, only valid components remain in the DB for downstream generation', async () => {
    const sessionId = await seedSession([validComponent, invalidComponent]);
    const { code } = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
      { artifactsRoot, dbPath },
    );
    expect(code).toBe(0);

    // After select-all, the DB should only contain the components that were accepted.
    // The invalid component must not be reachable by downstream steps (generate, apply).
    const db = openPipelineDb(dbPath);
    const rows = db.prepare(`SELECT name FROM raw_components WHERE session_id = ?`).all(sessionId) as Array<{
      name: string;
    }>;
    db.close();

    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['GoodComponent']);
    expect(names).not.toContain('BadComponent');
  });
});
