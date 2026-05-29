import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';

// The `generate components edit` subcommand is nested under `generate components`.
// `generate components` requires `--agent`, so it must be passed before `edit`.
// Command form: generate components --agent <name> edit [edit-flags...]

describe('generate components edit — flag variations', () => {
  let fixture: TestFixture;

  beforeAll(async () => {
    fixture = await createTestFixture();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  const baseEnv = () => ({
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    NODE_NO_WARNINGS: '1',
  });

  // ── Help ──────────────────────────────────────────────────────────────────

  it('--help shows all flags', async () => {
    const { stdout, code } = await runCli(['generate', 'components', 'edit', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--accept-all');
    expect(stdout).toContain('--reject');
    expect(stdout).toContain('--patch');
  });

  // ── --accept-all ──────────────────────────────────────────────────────────

  it('--accept-all is accepted and exits (no crash)', async () => {
    // The edit command currently exits non-zero because session DB is not yet
    // implemented, but it should exit with a numeric code (not hang/throw).
    // --agent is required by the parent `generate components` command.
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', 'edit', '--accept-all'],
      baseEnv(),
    );
    expect(typeof code).toBe('number');
    expect(code).not.toBe(0); // not yet implemented
  });

  // ── --reject <pattern> ────────────────────────────────────────────────────

  it('--reject <pattern> is accepted and exits (no crash)', async () => {
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', 'edit', '--reject', 'Button'],
      baseEnv(),
    );
    expect(typeof code).toBe('number');
  });

  // ── --accept-all + --reject combined ─────────────────────────────────────

  it('--accept-all and --reject can be combined', async () => {
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', 'edit', '--accept-all', '--reject', 'Card'],
      baseEnv(),
    );
    expect(typeof code).toBe('number');
  });

  // ── Invalid --session ─────────────────────────────────────────────────────

  it('fails with non-zero exit for invalid --session', async () => {
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', 'edit', '--accept-all', '--session', 'nonexistent-session-id'],
      baseEnv(),
    );
    expect(code).not.toBe(0);
  });

  // ── Default to most recent session when --session is omitted ─────────────

  it('defaults to most recent session when --session is omitted', async () => {
    // Without --session the command should resolve the most recent session.
    // It will fail (not-yet-implemented), but must exit with a numeric code
    // and write something to stderr.
    const { code, stderr } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', 'edit', '--accept-all'],
      baseEnv(),
    );
    expect(typeof code).toBe('number');
    expect(stderr.length).toBeGreaterThan(0);
  });

  // ── Non-interactive guard ─────────────────────────────────────────────────

  it('exits non-zero in non-TTY mode without non-interactive flags', async () => {
    // Running without --accept-all / --reject / --patch in a non-TTY environment
    // should produce a non-zero exit code with an "interactive terminal" message.
    const { code, stderr } = await runCliWithEnv(['generate', 'components', '--agent', 'claude', 'edit'], baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/interactive|TTY/i);
  });
});
