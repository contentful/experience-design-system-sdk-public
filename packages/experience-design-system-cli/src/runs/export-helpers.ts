import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PrintResult = { ok: true } | { ok: false; error: string };

function findCliPath(): string {
  return join(fileURLToPath(import.meta.url), '..', '..', '..', 'bin', 'cli.js');
}

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    execFile('node', [findCliPath(), ...args], (err, stdout, stderr) => {
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
