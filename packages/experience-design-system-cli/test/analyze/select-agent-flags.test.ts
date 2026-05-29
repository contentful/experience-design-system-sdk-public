import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';
import { createMockAgent, type MockAgent } from '../helpers/mock-agent.js';

describe('analyze select-agent — flag variations', () => {
  let fixture: TestFixture;
  let agent: MockAgent;

  beforeAll(async () => {
    fixture = await createTestFixture();
    agent = await createMockAgent('claude');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await agent.cleanup();
  });

  const baseEnv = () => ({
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    NODE_NO_WARNINGS: '1',
    ...agent.env(),
  });

  // ── Help ──────────────────────────────────────────────────────────────────

  it('prints help with --help', async () => {
    const { stdout, code } = await runCli(['analyze', 'select-agent', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--agent');
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--model');
    expect(stdout).toContain('--verbose');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--project-root');
  });

  // ── Required flag guard ───────────────────────────────────────────────────

  it('fails without required --agent flag', async () => {
    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--session', fixture.sessionId],
      baseEnv(),
    );
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--agent|required/i);
  });

  // ── --dry-run ─────────────────────────────────────────────────────────────

  it('--dry-run prints the prompt without invoking the agent', async () => {
    const { stdout, code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--dry-run'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('--dry-run + --verbose prints the prompt without invoking the agent', async () => {
    const { stdout, code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--dry-run', '--verbose'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  // ── --model ───────────────────────────────────────────────────────────────

  it('--model accepts an arbitrary model name (dry-run so no agent call needed)', async () => {
    const { code } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--model',
        'claude-opus-4-5',
        '--dry-run',
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  // ── Nonexistent agent binary ──────────────────────────────────────────────

  it('fails when --agent references a nonexistent binary', async () => {
    const dbOnlyEnv = {
      EDS_PIPELINE_DB_PATH: fixture.dbPath,
      NODE_NO_WARNINGS: '1',
    };
    const { code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'experiences-test-nonexistent-agent-xyz', '--session', fixture.sessionId],
      dbOnlyEnv,
    );
    expect(code).not.toBe(0);
  });

  // ── Invalid --session ─────────────────────────────────────────────────────

  it('fails with an invalid --session id', async () => {
    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', 'nonexistent-session-id-xyz'],
      baseEnv(),
    );
    expect(code).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
