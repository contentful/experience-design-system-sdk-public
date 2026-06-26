import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PrintResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve the path to the package's CLI binary (`<pkg>/bin/cli.js`).
 *
 * Walks up from this module's location until it finds a directory that
 * contains `bin/cli.js`. This is robust to layout differences between source
 * (`<pkg>/src/runs/export-helpers.ts`) and compiled output
 * (`<pkg>/dist/src/runs/export-helpers.js`) — the previous string-counted
 * `..` chain was off-by-one against the compiled layout, sending lookups to
 * `<pkg>/dist/bin/cli.js` (which does not exist).
 */
function findCliPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  // Search up to 8 levels; the real distance is 3 (src) or 4 (dist/src).
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'bin', 'cli.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the compiled-layout path; the existsSync check in runCli
  // will surface a clear error if it is missing.
  return join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'bin', 'cli.js');
}

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliPath = findCliPath();
  if (!existsSync(cliPath)) {
    return Promise.resolve({
      exitCode: 1,
      stdout: '',
      stderr: `Cannot find CLI binary at ${cliPath}`,
    });
  }
  return new Promise((res) => {
    execFile('node', [cliPath, ...args], (err, stdout, stderr) => {
      res({ exitCode: err && 'code' in err && typeof err.code === 'number' ? err.code : err ? 1 : 0, stdout, stderr });
    });
  });
}

export async function printComponentsFromSession(opts: {
  sessionId: string;
  outPath: string;
}): Promise<PrintResult> {
  const r = await runCli(['print', 'components', '--session', opts.sessionId, '--out', opts.outPath]);
  if (r.exitCode === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || `exit ${r.exitCode}` };
}

export async function printTokensFromSession(opts: {
  sessionId: string;
  outPath: string;
}): Promise<PrintResult> {
  const r = await runCli(['print', 'tokens', '--session', opts.sessionId, '--out', opts.outPath]);
  if (r.exitCode === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || `exit ${r.exitCode}` };
}

/** Internal test surface. Not part of the public API. */
export const __testing = { findCliPath };
