import { binaryExists } from '../helpers/binary-exists.js';
import { runSpawn } from '../helpers/run-spawn.js';

export type PnpmCheck =
  | { status: 'missing' }
  | { status: 'broken' }
  | { status: 'unusable-in-repo'; version: string }
  | { status: 'ok'; version: string };

type PnpmDeps = { binaryExists: typeof binaryExists; run: typeof runSpawn };

async function detectPnpm(
  deps: PnpmDeps = { binaryExists, run: runSpawn },
): Promise<Extract<PnpmCheck, { status: 'missing' | 'broken' | 'ok' }>> {
  if (!(await deps.binaryExists('pnpm'))) return { status: 'missing' };
  const version = await deps.run('pnpm', ['--version']);
  if (version.exitCode !== 0) return { status: 'broken' };
  return { status: 'ok', version: version.stdout.trim() };
}

export async function checkPnpm(pkgRoot: string, deps: PnpmDeps = { binaryExists, run: runSpawn }): Promise<PnpmCheck> {
  const detected = await detectPnpm(deps);
  if (detected.status !== 'ok') return detected;

  const ping = await deps.run('pnpm', ['exec', 'node', '--version'], { cwd: pkgRoot });
  if (ping.exitCode !== 0) return { status: 'unusable-in-repo', version: detected.version };

  return detected;
}
