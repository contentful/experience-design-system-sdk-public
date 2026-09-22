/**
 * Tier 2 — every process.exit(1) validation branch in
 * packages/experience-design-system-cli/src/import/command.ts.
 *
 * These tests do NOT drive a PTY. They spawn the CLI headlessly and
 * assert on stderr + exit code. The validation checks fire before the
 * wizard opens, so no terminal is needed and the tests are fast.
 *
 * Every case here maps 1:1 to a `process.exit(1)` in command.ts.
 * When you add a new mutex rule there, add a case here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';

describe('experiences import — validation branches', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  // Every case gets its own isolated HOME so runs.json / credentials.json
  // don't leak between tests (and so the CLI can't accidentally find a real
  // run that would sidestep the validation check).
  function isolated() {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    return t.env;
  }

  // ── --push-from-run mutex rules ──────────────────────────────────────────

  it('rejects --push-from-run + --modify', async () => {
    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'x', '--modify', 'y'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--push-from-run and --modify are mutually exclusive/);
  });

  it('rejects --push-from-run + --project', async () => {
    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'x', '--project', '/tmp/somewhere'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--push-from-run and --project are mutually exclusive/);
  });

  it('rejects --push-from-run + --no-save', async () => {
    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'x', '--no-save'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--push-from-run and --no-save are mutually exclusive/);
  });

  it('rejects --push-from-run + --no-push', async () => {
    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'x', '--no-push'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--push-from-run and --no-push are mutually exclusive/);
  });

  it('rejects --push-from-run + --overwrite', async () => {
    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'x', '--overwrite'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--overwrite and --save-as-new only apply with --modify/);
  });

  it('rejects --push-from-run + --save-as-new', async () => {
    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'x', '--save-as-new'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--overwrite and --save-as-new only apply with --modify/);
  });

  it('surfaces a not-found error for a bogus --push-from-run id', async () => {
    const { code, stderr } = await runCli(
      ['import', '--push-from-run', 'run-does-not-exist'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/Run run-does-not-exist not found/);
  });

  // ── --modify mutex rules ─────────────────────────────────────────────────

  it('rejects --modify + --project', async () => {
    const { code, stderr } = await runCli(
      ['import', '--modify', 'x', '--project', '/tmp/somewhere'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--modify and --project are mutually exclusive/);
  });

  it('rejects --modify + --overwrite + --save-as-new', async () => {
    const { code, stderr } = await runCli(
      ['import', '--modify', 'x', '--overwrite', '--save-as-new'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--overwrite and --save-as-new are mutually exclusive/);
  });

  it('surfaces a not-found error for a bogus --modify id', async () => {
    const { code, stderr } = await runCli(
      ['import', '--modify', 'run-does-not-exist'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/Run run-does-not-exist not found/);
  });

  // ── --overwrite / --save-as-new require --modify ─────────────────────────

  it('rejects --overwrite without --modify', async () => {
    const { code, stderr } = await runCli(
      ['import', '--overwrite', '--skip-apply'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--overwrite and --save-as-new require --modify/);
  });

  it('rejects --save-as-new without --modify', async () => {
    const { code, stderr } = await runCli(
      ['import', '--save-as-new', '--skip-apply'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--overwrite and --save-as-new require --modify/);
  });

  // ── --no-save mutex rules ────────────────────────────────────────────────

  it('rejects --no-save + --no-push', async () => {
    const { code, stderr } = await runCli(
      ['import', '--no-save', '--no-push'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--no-save and --no-push together would do nothing/);
  });

  it('rejects --no-save + --out-dir', async () => {
    const { code, stderr } = await runCli(
      ['import', '--no-save', '--out-dir', '/tmp/x'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--no-save and --out-dir are mutually exclusive/);
  });

  it('rejects --no-save + --on-conflict', async () => {
    const { code, stderr } = await runCli(
      ['import', '--no-save', '--on-conflict', 'overwrite'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--no-save and --on-conflict are mutually exclusive/);
  });

  // ── --raw-tokens validation ──────────────────────────────────────────────

  it('rejects --raw-tokens + --tokens', async () => {
    const { code, stderr } = await runCli(
      [
        'import',
        '--raw-tokens',
        '/tmp/a.scss',
        '--tokens',
        '/tmp/b.json',
        '--skip-apply',
      ],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--raw-tokens and --tokens are mutually exclusive/);
  });

  it('rejects --raw-tokens pointing at a missing file', async () => {
    const { code, stderr } = await runCli(
      ['import', '--raw-tokens', '/tmp/nope-does-not-exist.scss', '--skip-apply'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(
      /--raw-tokens: file not found: \/tmp\/nope-does-not-exist\.scss/,
    );
  });

  // ── --on-conflict value validation (commander parser) ────────────────────

  it('rejects a bogus --on-conflict value', async () => {
    const { code, stderr } = await runCli(
      ['import', '--on-conflict', 'bogus'],
      { env: isolated() },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/invalid --on-conflict value 'bogus'/);
  });

  // ── Missing credentials without --skip-apply (headless path only) ────────
  //
  // The "credentials required" check sits after the TTY gate. Feeding a
  // headless flag (--yes) drops us into that path even without a PTY.

  it('requires credentials (or --skip-apply) in headless mode', async () => {
    // --yes forces headless. No credentials → error.
    const { code, stderr } = await runCli(['import', '--yes'], {
      env: {
        ...isolated(),
        // Ensure env-var creds don't accidentally satisfy the check.
        CONTENTFUL_SPACE_ID: '',
        CONTENTFUL_ENVIRONMENT_ID: '',
        CONTENTFUL_MANAGEMENT_TOKEN: '',
      },
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/--space-id .* --environment-id .* --cma-token .* are required/s);
  });

  // ── Non-TTY interactive-required error ───────────────────────────────────
  //
  // With no headless flag and no autoAcceptScope, running under a plain
  // pipe (which is exactly what runCli() gives us) must emit the
  // "experiences import is interactive" error.

  it('rejects a plain-pipe invocation with no headless / auto-accept flag', async () => {
    const { code, stderr } = await runCli(['import'], { env: isolated() });
    expect(code).toBe(1);
    expect(stderr).toMatch(/experiences import is interactive/);
  });
});
