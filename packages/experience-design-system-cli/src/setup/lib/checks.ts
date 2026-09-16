import { join } from 'node:path';
import { REQUIRED_NODE_MAJOR, binaryExists, pathExists, runSpawn, type ShellCommandResult } from './shell.js';

/**
 * The decision half of each prerequisite check, shared by `experiences doctor`
 * and the setup wizard's Prerequisites step. Neither writes output from here:
 * doctor streams ANSI, setup emits events for Ink, and both need the same
 * verdict. Anything a caller needs for its own wording is returned rather than
 * printed.
 */

export interface NodeVersionCheck {
  passed: boolean;
  version: string;
  major: number;
  required: number;
}

export function checkNodeVersion(nodeVersion: string = process.versions.node): NodeVersionCheck {
  const major = Number.parseInt(nodeVersion.split('.')[0]!, 10);
  return { passed: major >= REQUIRED_NODE_MAJOR, version: nodeVersion, major, required: REQUIRED_NODE_MAJOR };
}

/** Which Node version manager is available, so callers can offer the right fix. */
export interface NodeVersionManagers {
  nvm: boolean;
  fnm: boolean;
  nvmScript: string;
}

export async function detectNodeVersionManagers(
  homeDir: string,
  deps: { binaryExists: typeof binaryExists; pathExists: typeof pathExists } = { binaryExists, pathExists },
): Promise<NodeVersionManagers> {
  const nvmScript = join(homeDir, '.nvm', 'nvm.sh');
  return {
    nvm: (await deps.binaryExists('nvm')) || (await deps.pathExists(nvmScript)),
    fnm: await deps.binaryExists('fnm'),
    nvmScript,
  };
}

export type PnpmCheck =
  | { status: 'missing' }
  | { status: 'broken' }
  | { status: 'unusable-in-repo'; version: string }
  | { status: 'ok'; version: string };

type PnpmDeps = { binaryExists: typeof binaryExists; run: typeof runSpawn };

/** Whether pnpm is on PATH and reports a version. */
export async function detectPnpm(
  deps: PnpmDeps = { binaryExists, run: runSpawn },
): Promise<Extract<PnpmCheck, { status: 'missing' | 'broken' | 'ok' }>> {
  if (!(await deps.binaryExists('pnpm'))) return { status: 'missing' };
  const version = await deps.run('pnpm', ['--version']);
  if (version.exitCode !== 0) return { status: 'broken' };
  return { status: 'ok', version: version.stdout.trim() };
}

/**
 * `detectPnpm` plus proof that pnpm can execute inside the repo. A store built
 * against a different Node version still passes `--version` but fails there,
 * which is the failure operators actually hit — so doctor checks it, while the
 * setup wizard only needs to know pnpm exists before it installs.
 */
export async function checkPnpm(pkgRoot: string, deps: PnpmDeps = { binaryExists, run: runSpawn }): Promise<PnpmCheck> {
  const detected = await detectPnpm(deps);
  if (detected.status !== 'ok') return detected;

  const ping = await deps.run('pnpm', ['exec', 'node', '--version'], { cwd: pkgRoot });
  if (ping.exitCode !== 0) return { status: 'unusable-in-repo', version: detected.version };

  return detected;
}

export interface InstallCheck {
  passed: boolean;
  /** Whether `node_modules` was already present, which changes doctor's wording. */
  hadNodeModules: boolean;
  result: ShellCommandResult;
}

export async function installDependencies(
  pkgRoot: string,
  deps: { pathExists: typeof pathExists; run: typeof runSpawn } = { pathExists, run: runSpawn },
): Promise<InstallCheck> {
  const hadNodeModules = await deps.pathExists(join(pkgRoot, 'node_modules'));
  const repoRoot = join(pkgRoot, '..', '..');
  const result = await deps.run('pnpm', ['install', '--frozen-lockfile'], { cwd: repoRoot });
  return { passed: result.exitCode === 0, hadNodeModules, result };
}

export interface BuildCheck {
  passed: boolean;
  result: ShellCommandResult;
}

export async function buildCli(
  repoRoot: string,
  deps: { run: typeof runSpawn } = { run: runSpawn },
): Promise<BuildCheck> {
  const result = await deps.run('pnpm', ['--filter', '@contentful/experience-design-system-cli', 'run', 'build'], {
    cwd: repoRoot,
  });
  return { passed: result.exitCode === 0, result };
}
