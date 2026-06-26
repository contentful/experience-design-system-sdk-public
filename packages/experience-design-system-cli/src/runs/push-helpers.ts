import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PushSessionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve the package's CLI binary. Duplicates the walk from export-helpers
 * so push-helpers can be imported independently.
 */
function findCliPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'bin', 'cli.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
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
      res({
        exitCode: err && 'code' in err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

export type PushSessionOptions = {
  sessionId: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host?: string;
};

/**
 * Push a recorded pipeline.db session's components + tokens to Contentful by
 * shelling out to `experiences apply push --session <id>`. Does no local
 * file I/O — that is the whole point of --push-from-run.
 */
export async function pushRunSession(opts: PushSessionOptions): Promise<PushSessionResult> {
  const args = [
    'apply',
    'push',
    '--session',
    opts.sessionId,
    '--space-id',
    opts.spaceId,
    '--environment-id',
    opts.environmentId,
    '--cma-token',
    opts.cmaToken,
    '--yes',
  ];
  if (opts.host) {
    args.push('--host', opts.host);
  }
  const r = await runCli(args);
  if (r.exitCode === 0) return { ok: true };
  return { ok: false, error: r.stderr.trim() || r.stdout.trim() || `exit ${r.exitCode}` };
}

/** Internal test surface. Not part of the public API. */
export const __testing = { findCliPath };
