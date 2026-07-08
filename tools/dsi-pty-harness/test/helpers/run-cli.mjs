/**
 * Spawn the `experiences` CLI headlessly (no PTY) and return
 * { stdout, stderr, code }. Use for validation tests that assert on
 * process.exit(1) branches — no need for a terminal.
 *
 * The wizard's `!process.stdout.isTTY && !isHeadless && !autoAcceptScope`
 * branch will otherwise print its "interactive" error whenever there's
 * no TTY, which would collide with the specific mutex errors we're
 * asserting on. Every case must include enough flags to enter the
 * headless code path OR pass `--auto-accept-scope`, OR trip a validation
 * error that fires *before* the TTY check.
 *
 * All the Tier-2 mutex checks in command.ts happen BEFORE the TTY gate,
 * so they fire regardless of TTY. Only the "requires --skip-apply / creds"
 * error (line ~439) sits after the TTY branch — that test uses `--skip-apply`
 * or fixture creds.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(
  HERE,
  '../../../../packages/experience-design-system-cli/bin/cli.js',
);

export function runCli(args, opts = {}) {
  return new Promise((res, rej) => {
    const child = spawn('node', [CLI_BIN, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', rej);
    child.on('close', (code, signal) => {
      res({ stdout, stderr, code: signal ? null : code, signal });
    });
    if (opts.timeoutMs) {
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, opts.timeoutMs);
    }
  });
}
