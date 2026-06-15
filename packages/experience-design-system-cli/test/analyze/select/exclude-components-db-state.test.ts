import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { openPipelineDb, storeRawComponents, getOrCreateSession, loadCDFComponents } from '../../../src/session/db.js';
import { registerAnalyzeEditCommand } from '../../../src/analyze/select/command.js';
import type { RawComponentDefinition } from '../../../src/types.js';

/**
 * Verification test for the SP-4 retry-loop concern raised during review:
 * does `analyze select --select-all --exclude-components <names>` leave the
 * surviving components in a state where the next `apply push` can find them?
 *
 * Specifically: `loadCDFComponents` (called by `apply push` and the wizard's
 * runPreview) reads `raw_components WHERE status = 'generated'` and joins
 * `raw_props WHERE cdf_type IS NOT NULL`. If `--exclude-components` resets
 * either of those, the retry sends an empty manifest and the loop is broken.
 *
 * The orchestrator's retry loop fires AFTER the `generate components` step has
 * already flipped status to 'generated' and populated cdf_type, so the test
 * seeds both before invoking `--exclude-components`.
 *
 * Fix: when --exclude-components is given on its own (no --select-all etc.),
 * runNonInteractive short-circuits through rejectComponentsByName, which is a
 * pure UPDATE and leaves status='generated' + cdf_type intact. The orchestrator
 * was also updated to stop passing --select-all alongside --exclude-components.
 */

async function runCli(
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

describe('--exclude-components — DB state after retry-loop invocation', () => {
  let tmpDir: string;
  let dbPath: string;
  let artifactsRoot: string;
  let sessionId: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'excl-comps-db-'));
    dbPath = join(tmpDir, 'pipeline.db');
    artifactsRoot = join(tmpDir, 'reviews');

    await writeFile(join(tmpDir, 'A.tsx'), '// A\n');
    await writeFile(join(tmpDir, 'B.tsx'), '// B\n');
    await writeFile(join(tmpDir, 'C.tsx'), '// C\n');

    const db = openPipelineDb(dbPath);
    const session = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: tmpDir,
      outDir: tmpDir,
    });
    sessionId = session.sessionId;

    const make = (name: string): RawComponentDefinition => ({
      name,
      source: join(tmpDir, `${name}.tsx`),
      framework: 'react',
      props: [{ name: 'variant', type: 'string', required: false, category: 'content' }],
      slots: [],
      extractionConfidence: 1,
      reviewReasons: [],
      needsReview: false,
    });
    storeRawComponents(db, sessionId, [make('A'), make('B'), make('C')]);

    // Simulate the post-`generate components` state that the orchestrator's
    // retry loop encounters: status='generated' and cdf_type populated, so
    // loadCDFComponents would return all three before the retry runs.
    db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);
    db.prepare(`UPDATE raw_props SET cdf_type = 'Text', cdf_category = 'content' WHERE session_id = ?`).run(sessionId);

    db.close();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function readState(): { statuses: Record<string, string>; cdfNames: string[] } {
    const db = openPipelineDb(dbPath);
    try {
      const rows = db.prepare(`SELECT name, status FROM raw_components WHERE session_id = ?`).all(sessionId) as Array<{
        name: string;
        status: string;
      }>;
      const cdf = loadCDFComponents(db, sessionId).map((c) => c.key);
      return {
        statuses: Object.fromEntries(rows.map((r) => [r.name, r.status])),
        cdfNames: cdf,
      };
    } finally {
      db.close();
    }
  }

  it('SANITY: pre-conditions hold before the retry-loop call', () => {
    const { statuses, cdfNames } = readState();
    expect(statuses).toEqual({ A: 'generated', B: 'generated', C: 'generated' });
    expect(cdfNames.sort()).toEqual(['A', 'B', 'C']);
  });

  it('after `analyze select --exclude-components B` (the orchestrator retry-loop call), surviving components stay visible to the next apply push', async () => {
    // This is the orchestrator retry-loop invocation, verbatim. See
    // orchestrator.ts in this branch:
    //   analyze select --session <id> --exclude-components <names>
    // (no --select-all; that flag would route through the rebuild path which
    // wipes status='generated' + raw_props.cdf_type).
    const result = await runCli(
      ['analyze', 'select', '--session', sessionId, '--project-root', tmpDir, '--exclude-components', 'B'],
      { artifactsRoot, dbPath },
    );
    expect(result.code).toBe(0);

    const { statuses, cdfNames } = readState();

    expect(statuses['B']).toBe('generate-rejected');
    expect(statuses['A']).toBe('generated');
    expect(statuses['C']).toBe('generated');

    // CRITICAL: A and C must still be loadable by apply push. Otherwise the
    // retry sends an empty manifest and the loop never recovers.
    expect(cdfNames.sort()).toEqual(['A', 'C']);
  });

  it('SEALED: --select-all + --exclude-components no longer wipes generate state (PR #31 idempotency fix)', async () => {
    // Pre-PR #31 behavior: combining --select-all with --exclude-components
    // routed through the rebuild path (storeRawComponents → DELETE + re-INSERT)
    // and reset surviving components to status='extracted' / dropped cdf_type.
    // The wizard's old retry loop guarded against this by avoiding the
    // combination; PR #31 sealed the destructive path by gating
    // storeRawComponents behind `opts.patch` (the only flag that legitimately
    // mutates editedProposal). The DB now stays untouched on status-only flag
    // combinations.
    //
    // This test pins the sealed contract: even if a caller passes the
    // combination, the post-generate DB state survives and the next
    // `apply push` still finds the surviving components.
    const result = await runCli(
      [
        'analyze',
        'select',
        '--session',
        sessionId,
        '--project-root',
        tmpDir,
        '--select-all',
        '--exclude-components',
        'B',
      ],
      { artifactsRoot, dbPath },
    );
    expect(result.code).toBe(0);

    const { statuses, cdfNames } = readState();
    // DB state is untouched by either flag — the JSON state file reflects the
    // rejection but raw_components.status is unchanged. (The orchestrator
    // doesn't call this combination; --exclude-components on its own
    // short-circuits through rejectComponentsByName which DOES update the DB.)
    expect(statuses['A']).toBe('generated');
    expect(statuses['B']).toBe('generated');
    expect(statuses['C']).toBe('generated');
    expect(cdfNames.sort()).toEqual(['A', 'B', 'C']);
  });
});
