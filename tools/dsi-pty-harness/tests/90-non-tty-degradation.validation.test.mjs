/**
 * Tier 6 — non-TTY invocation.
 *
 * With `stdio: ['ignore', 'pipe', 'pipe']` the child sees `!isTTY` and
 * `experiences import` (no bypass flags) MUST fail with a clear
 * "interactive" error rather than mounting an Ink render into a pipe
 * (which would corrupt output with ANSI escapes and hang on stdin).
 *
 * `TERM=dumb` is the historical smoke test for terminals without color
 * or cursor support — verify the same friendly error surfaces there.
 * JSON-producing headless subcommands (e.g. apply preview) must emit
 * valid JSON regardless of TERM.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { startMockEma } from './helpers/mock-ema.mjs';
import { REACT_MINIMAL_COMPONENTS_JSON } from './helpers/fixtures.mjs';

describe('non-TTY degradation', () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()();
  });

  it('experiences import (no bypass flags) exits 1 with a helpful message', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, code } = await runCli(['import'], { env: t.env });
    expect(code).toBe(1);
    expect(stderr).toMatch(/experiences import is interactive/);
    // The message enumerates every bypass — a durable contract for docs.
    expect(stderr).toMatch(/--auto-accept-scope/);
    expect(stderr).toMatch(/--yes|--dry-run|--print-prompt|--skip-/);
  });

  it('experiences import with TERM=dumb still surfaces the interactive error cleanly', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, stdout, code } = await runCli(['import'], {
      env: { ...t.env, TERM: 'dumb' },
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/experiences import is interactive/);
    // No stray ANSI escape sequences in either stream — bail-out is a
    // plain string, not a rendered Ink frame.
    expect(stderr).not.toMatch(/\x1b\[/);
    expect(stdout).not.toMatch(/\x1b\[/);
  });

  it('apply preview emits valid JSON to stdout under TERM=dumb', async () => {
    const server = await startMockEma();
    cleanups.push(() => server.close());
    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    const { stdout, code } = await runCli(
      [
        'apply',
        'preview',
        '--components',
        REACT_MINIMAL_COMPONENTS_JSON,
        '--space-id',
        'sp1',
        '--environment-id',
        'master',
        '--cma-token',
        'fake-token',
        '--host',
        server.host,
      ],
      { env: { ...t.env, TERM: 'dumb' } },
    );
    expect(code).toBe(0);
    // Parse — throws on any ANSI leakage or wrapping garbage.
    const parsed = JSON.parse(stdout);
    expect(parsed.spaceId).toBe('sp1');
    expect(parsed.environmentId).toBe('master');
  });
});
