import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../../src/session/db.js';
import { registerAnalyzeEditCommand } from '../../../src/analyze/select/command.js';
import type { RawComponentDefinition } from '../../../src/types.js';

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

  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origArtifactsDir = process.env.EDS_REVIEW_ARTIFACTS_DIR;
  const origDbPath = process.env.EDS_PIPELINE_DB_PATH;

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
    await program.parseAsync(['node', 'cli', ...args], { from: 'node' });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const exitCode = typeof error === 'object' && error && 'exitCode' in error ? Number(error.exitCode) : 1;
    return { stdout, stderr, code: exitCode };
  } finally {
    if (origArtifactsDir === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    else process.env.EDS_REVIEW_ARTIFACTS_DIR = origArtifactsDir;
    if (origDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = origDbPath;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
}

let tmpDir: string;
let dbPath: string;
let artifactsRoot: string;
let sessionId: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'excl-comps-test-'));
  dbPath = join(tmpDir, 'pipeline.db');
  artifactsRoot = join(tmpDir, 'reviews');

  // Create real source files so loadAndValidateForReview can stat them
  await writeFile(join(tmpDir, 'Button.tsx'), '// Button\n');
  await writeFile(join(tmpDir, 'Card.tsx'), '// Card\n');
  await writeFile(join(tmpDir, 'PageLink.tsx'), '// PageLink\n');

  const db = openPipelineDb(dbPath);
  const session = getOrCreateSession(db, undefined, undefined, {
    command: 'analyze extract',
    inputPath: tmpDir,
    outDir: tmpDir,
  });
  sessionId = session.sessionId;

  const makeComponent = (name: string): RawComponentDefinition => ({
    name,
    source: join(tmpDir, `${name}.tsx`),
    framework: 'react',
    props: [{ name: 'variant', type: 'string', required: false }],
    slots: [],
    extractionConfidence: 1,
    reviewReasons: [],
    needsReview: false,
  });

  storeRawComponents(db, sessionId, [makeComponent('Button'), makeComponent('Card'), makeComponent('PageLink')]);
  db.close();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('analyze select --exclude-components', () => {
  it('force-rejects named components and accepts the rest when combined with --select-all', async () => {
    const result = await run(
      [
        'analyze',
        'select',
        '--session',
        sessionId,
        '--project-root',
        tmpDir,
        '--select-all',
        '--exclude-components',
        'PageLink',
      ],
      { artifactsRoot, dbPath },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/Accepted: 2\s+Rejected: 1/);
  });

  it('rejects multiple comma-separated names', async () => {
    const result = await run(
      [
        'analyze',
        'select',
        '--session',
        sessionId,
        '--project-root',
        tmpDir,
        '--select-all',
        '--exclude-components',
        'Button,Card',
      ],
      { artifactsRoot, dbPath },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/Accepted: 1\s+Rejected: 2/);
  });

  it('ignores whitespace around names in the comma list', async () => {
    const result = await run(
      [
        'analyze',
        'select',
        '--session',
        sessionId,
        '--project-root',
        tmpDir,
        '--select-all',
        '--exclude-components',
        ' Button , Card ',
      ],
      { artifactsRoot, dbPath },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/Accepted: 1\s+Rejected: 2/);
  });

  it('silently skips names that do not match any component', async () => {
    const result = await run(
      [
        'analyze',
        'select',
        '--session',
        sessionId,
        '--project-root',
        tmpDir,
        '--select-all',
        '--exclude-components',
        'NonExistent',
      ],
      { artifactsRoot, dbPath },
    );

    expect(result.code).toBe(0);
    // All three accepted — unknown name does not cause a failure
    expect(result.stderr).toMatch(/Accepted: 3\s+Rejected: 0/);
  });

  it('works without --select-all — triggers non-interactive path and rejects only the named component', async () => {
    const result = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--exclude-components', 'Card'],
      { artifactsRoot, dbPath },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/Rejected: 1/);
  });
});
