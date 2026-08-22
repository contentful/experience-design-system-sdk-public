import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { findCliPath } from '../lib/cli-path.js';

export type PrintResult = { ok: true } | { ok: false; error: string };

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

export async function printComponentsFromSession(opts: { sessionId: string; outPath: string }): Promise<PrintResult> {
  const r = await runCli(['print', 'components', '--session', opts.sessionId, '--out', opts.outPath]);
  if (r.exitCode === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || `exit ${r.exitCode}` };
}

export async function printTokensFromSession(opts: { sessionId: string; outPath: string }): Promise<PrintResult> {
  const r = await runCli(['print', 'tokens', '--session', opts.sessionId, '--out', opts.outPath]);
  if (r.exitCode === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || `exit ${r.exitCode}` };
}

/** Internal test surface. Not part of the public API. */
export const __testing = { findCliPath };
