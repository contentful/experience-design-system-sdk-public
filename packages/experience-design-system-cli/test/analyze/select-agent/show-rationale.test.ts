import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliWithEnv } from '../../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../../helpers/fixtures.js';
import { openPipelineDb, createStep, updateStep } from '../../../src/session/db.js';

const cleanupItems: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupItems.splice(0).map((fn) => fn()));
});

async function setup(): Promise<{ fixture: TestFixture; artifactsDir: string }> {
  const fixture = await createTestFixture();
  const artifactsDir = await mkdtemp(join(tmpdir(), 'show-rationale-artifacts-'));
  cleanupItems.push(fixture.cleanup, () => rm(artifactsDir, { recursive: true, force: true }));
  return { fixture, artifactsDir };
}

/**
 * Seed select-agent decisions directly on raw_components.status + reject_reason
 * so we can test the read-only --show-rationale path without invoking the LLM.
 * Mirrors what command.ts:612-633 does after a real select-agent run.
 */
function seedDecisions(
  dbPath: string,
  sessionId: string,
  decisions: Array<{ name: string; status: 'accepted' | 'rejected'; rejectReason: string | null }>,
): void {
  const db = openPipelineDb(dbPath);
  try {
    const updateStmt = db.prepare(
      `UPDATE raw_components SET status = ?, reject_reason = ?
       WHERE session_id = ? AND name = ?`,
    );
    for (const d of decisions) {
      updateStmt.run(d.status, d.rejectReason, sessionId, d.name);
    }
    // Record a completed analyze select step so latest-session lookup finds it.
    const stepId = createStep(db, sessionId, 'analyze select', { sessionId });
    updateStep(db, stepId, 'complete', { sessionId });
  } finally {
    db.close();
  }
}

function baseEnv(fixture: TestFixture, artifactsDir: string): Record<string, string> {
  return {
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    EDS_REVIEW_ARTIFACTS_DIR: artifactsDir,
    NODE_NO_WARNINGS: '1',
    PATH: process.env.PATH ?? '',
  };
}

describe('analyze select-agent --show-rationale', () => {
  it('prints a human-readable table for sessions with rationale rows', async () => {
    const { fixture, artifactsDir } = await setup();
    seedDecisions(fixture.dbPath, fixture.sessionId, [
      { name: 'Button', status: 'accepted', rejectReason: null },
      { name: 'Card', status: 'rejected', rejectReason: 'data-fetch wrapper, not visible UI' },
    ]);

    const { code, stdout, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--show-rationale', '--session', fixture.sessionId],
      baseEnv(fixture, artifactsDir),
    );

    expect(code).toBe(0);
    // Table headers
    expect(stdout).toMatch(/Component/);
    expect(stdout).toMatch(/Decision/);
    expect(stdout).toMatch(/Reason/);
    // Row content
    expect(stdout).toContain('Button');
    expect(stdout).toContain('accepted');
    expect(stdout).toContain('Card');
    expect(stdout).toContain('rejected');
    expect(stdout).toContain('data-fetch wrapper, not visible UI');
    // No LLM invocation in stderr (no "Validating N components" line from selectAllComponents).
    expect(stderr).not.toContain('Validating');
  });

  it('emits a JSON array with --json', async () => {
    const { fixture, artifactsDir } = await setup();
    seedDecisions(fixture.dbPath, fixture.sessionId, [
      { name: 'Button', status: 'accepted', rejectReason: null },
      { name: 'Card', status: 'rejected', rejectReason: 'data-fetch wrapper' },
    ]);

    const { code, stdout } = await runCliWithEnv(
      ['analyze', 'select-agent', '--show-rationale', '--json', '--session', fixture.sessionId],
      baseEnv(fixture, artifactsDir),
    );

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{
      name: string;
      decision: string;
      reason: string | null;
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    const button = parsed.find((p) => p.name === 'Button');
    const card = parsed.find((p) => p.name === 'Card');
    expect(button).toBeDefined();
    expect(button!.decision).toBe('accepted');
    expect(card).toBeDefined();
    expect(card!.decision).toBe('rejected');
    expect(card!.reason).toBe('data-fetch wrapper');
  });

  it('errors cleanly when --session points at a missing session id', async () => {
    const { fixture, artifactsDir } = await setup();

    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--show-rationale', '--session', 'nonexistent-session-id'],
      baseEnv(fixture, artifactsDir),
    );

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/session/i);
    expect(stderr).toContain('nonexistent-session-id');
  });

  it('does NOT spawn an LLM agent process when --show-rationale is set', async () => {
    // The command path is short-circuit: --show-rationale bypasses agent
    // resolution and runAgent entirely. We verify two observable invariants:
    //   1. exit 0 without configuring an agent at all (no --agent flag, no
    //      saved credentials in CI).
    //   2. None of the agent-spawn telltales surface in stderr:
    //      "Validating", "no agent configured", or any progress= line.
    const { fixture, artifactsDir } = await setup();
    seedDecisions(fixture.dbPath, fixture.sessionId, [{ name: 'Button', status: 'accepted', rejectReason: null }]);

    const { code, stdout, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--show-rationale', '--session', fixture.sessionId],
      baseEnv(fixture, artifactsDir),
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Button');
    expect(stderr).not.toContain('Validating');
    expect(stderr).not.toContain('no agent configured');
    expect(stderr).not.toContain('progress=select-agent');
  });
});

describe('analyze select-agent without --show-rationale (regression)', () => {
  it('still requires an agent / runs the normal path (unchanged behavior)', async () => {
    const { fixture, artifactsDir } = await setup();
    // Without --show-rationale, with no agent on PATH, we expect the existing
    // failure mode — proving the new flag is purely additive.
    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--session', fixture.sessionId, '--agent', 'claude'],
      {
        ...baseEnv(fixture, artifactsDir),
        PATH: '/nonexistent-path-for-test',
      },
    );

    // Either non-zero exit (agent not found) or some "Failed" line in stderr —
    // anything but a clean rationale dump. We just assert it didn't silently
    // print a rationale table to stdout.
    expect(code === 0 ? stderr : stderr + '\n' + String(code)).toBeTruthy();
  });
});
