import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../../src/session/db.js';
import { registerAnalyzeEditCommand } from '../../../src/analyze/select/command.js';

/**
 * Headless `--exclude-invalid` must surface WHICH components were excluded —
 * not just the bare counts. Without this, a non-interactive caller (CI,
 * orchestrator, scripted pipeline) sees `Accepted: N  Rejected: M` and has
 * no way to know which validation error caused the rejection. The user is
 * left guessing what to fix.
 */

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

describe('analyze select --select-all --exclude-invalid stderr output', () => {
  let tmpDir: string;
  let dbPath: string;
  let artifactsRoot: string;
  let sessionId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-excl-warn-'));
    dbPath = join(tmpDir, 'pipeline.db');
    artifactsRoot = join(tmpDir, 'reviews');
    await writeFile(join(tmpDir, 'BadSlot.tsx'), '// BadSlot\n');
    await writeFile(join(tmpDir, 'Good.tsx'), '// Good\n');

    const db = openPipelineDb(dbPath);
    const { sessionId: sid } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    sessionId = sid;
    storeRawComponents(db, sessionId, [
      {
        name: 'BadSlot',
        source: join(tmpDir, 'BadSlot.tsx'),
        framework: 'react',
        props: [],
        slots: [{ name: '', isDefault: false }],
      },
      {
        name: 'Good',
        source: join(tmpDir, 'Good.tsx'),
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
    ]);
    db.close();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('prints a Warning header listing the excluded component names + error codes', async () => {
    const result = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all', '--exclude-invalid'],
      { artifactsRoot, dbPath },
    );

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Warning:');
    expect(result.stderr).toContain('1 component(s) excluded due to validation errors');
    expect(result.stderr).toContain('BadSlot');
    expect(result.stderr).toContain('EMPTY_SLOT_NAME');
  });

  it('still prints the Accepted/Rejected count line', async () => {
    const result = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all', '--exclude-invalid'],
      { artifactsRoot, dbPath },
    );

    expect(result.stderr).toMatch(/Accepted:\s*1\s+Rejected:\s*1/);
  });

  it('does NOT print the Warning header when no components were excluded', async () => {
    // Re-seed without the bad component
    const db = openPipelineDb(dbPath);
    db.prepare(`DELETE FROM raw_components WHERE session_id = ?`).run(sessionId);
    db.close();

    const db2 = openPipelineDb(dbPath);
    storeRawComponents(db2, sessionId, [
      {
        name: 'Good',
        source: join(tmpDir, 'Good.tsx'),
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
    ]);
    db2.close();

    const result = await run(
      ['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all', '--exclude-invalid'],
      { artifactsRoot, dbPath },
    );

    expect(result.stderr).not.toContain('excluded due to validation errors');
    expect(result.stderr).toMatch(/Accepted:\s*1\s+Rejected:\s*0/);
  });
});

describe('analyze select --select-all without --exclude-invalid (fail-loud gate)', () => {
  // Default behavior: --select-all stops with a non-zero exit when ANY
  // component has error-severity validation issues. The user must opt in
  // to the auto-reject path with --exclude-invalid. Rationale: silent
  // exclusion is dangerous in CI/orchestrator contexts — the caller should
  // see and acknowledge that components are being dropped.
  let tmpDir: string;
  let dbPath: string;
  let artifactsRoot: string;
  let sessionId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eds-failloud-'));
    dbPath = join(tmpDir, 'pipeline.db');
    artifactsRoot = join(tmpDir, 'reviews');
    await writeFile(join(tmpDir, 'BadSlot.tsx'), '// BadSlot\n');
    await writeFile(join(tmpDir, 'Good.tsx'), '// Good\n');

    const db = openPipelineDb(dbPath);
    const { sessionId: sid } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    sessionId = sid;
    storeRawComponents(db, sessionId, [
      {
        name: 'BadSlot',
        source: join(tmpDir, 'BadSlot.tsx'),
        framework: 'react',
        props: [],
        slots: [{ name: '', isDefault: false }],
      },
      {
        name: 'Good',
        source: join(tmpDir, 'Good.tsx'),
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
    ]);
    db.close();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('exits non-zero when error-tier validation issues exist and --exclude-invalid is NOT set', async () => {
    const result = await run(['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all'], {
      artifactsRoot,
      dbPath,
    });

    expect(result.code).not.toBe(0);
  });

  it('lists the offending components + error codes in the failure message', async () => {
    const result = await run(['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all'], {
      artifactsRoot,
      dbPath,
    });

    expect(result.stderr).toContain('1 component(s) failed validation');
    expect(result.stderr).toContain('BadSlot');
    expect(result.stderr).toContain('EMPTY_SLOT_NAME');
  });

  it('hints at the --exclude-invalid flag in the failure message', async () => {
    const result = await run(['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all'], {
      artifactsRoot,
      dbPath,
    });

    expect(result.stderr).toContain('--exclude-invalid');
  });

  it('does NOT modify session state when the gate fails (no Accepted/Rejected line)', async () => {
    // The gate must short-circuit BEFORE saveReviewState runs — otherwise a
    // CI run that sees the failure and re-runs would inherit a partial state.
    const result = await run(['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all'], {
      artifactsRoot,
      dbPath,
    });

    expect(result.stderr).not.toMatch(/Accepted:\s*\d+\s+Rejected:\s*\d+/);
  });

  it('exits 0 when --select-all is passed and there are NO error-tier issues', async () => {
    // Re-seed without the bad component
    const db = openPipelineDb(dbPath);
    db.prepare(`DELETE FROM raw_components WHERE session_id = ?`).run(sessionId);
    db.close();

    const db2 = openPipelineDb(dbPath);
    storeRawComponents(db2, sessionId, [
      {
        name: 'Good',
        source: join(tmpDir, 'Good.tsx'),
        framework: 'react',
        props: [{ name: 'variant', type: 'string', required: false }],
        slots: [],
      },
    ]);
    db2.close();

    const result = await run(['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--select-all'], {
      artifactsRoot,
      dbPath,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toMatch(/Accepted:\s*1\s+Rejected:\s*0/);
  });
});
