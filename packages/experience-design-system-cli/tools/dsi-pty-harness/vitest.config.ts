import { defineConfig } from 'vitest/config';

/**
 * Two test flavors live here, gated by PTY_TESTS=1:
 *
 *   *.pty.test.mjs         — drive the wizard through a real PTY (slow)
 *   *.validation.test.mjs  — spawn the CLI headless, assert on stderr/exit
 *                            (fast; no TTY needed)
 *
 * Default `vitest run` (no env var) executes nothing and passes trivially,
 * so CI opt-in is explicit.
 *
 * Cap concurrent forks: PTY tests spawn full CLI processes and can starve
 * the runner if all 60+ tests fork at once.
 */
const enabled = process.env.PTY_TESTS === '1';

export default defineConfig({
  test: {
    include: enabled ? ['test/**/*.{pty,validation}.test.mjs'] : [],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    maxWorkers: 4,
    minWorkers: 1,
    passWithNoTests: true,
  },
});
