import { runSpawn } from '../helpers/run-spawn.js';
import type { ShellCommandResult } from '../types/shell.js';

export interface CommandCheck {
  passed: boolean;
  result: ShellCommandResult;
}

export async function installDependencies(
  repoRoot: string,
  deps: { run: typeof runSpawn } = { run: runSpawn },
): Promise<CommandCheck> {
  const result = await deps.run('pnpm', ['install', '--frozen-lockfile'], { cwd: repoRoot });
  return { passed: result.exitCode === 0, result };
}
