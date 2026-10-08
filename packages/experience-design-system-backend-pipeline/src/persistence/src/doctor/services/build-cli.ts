import { runSpawn } from '../helpers/run-spawn.js';
import type { CommandCheck } from './install-dependencies.js';

export async function buildCli(
  repoRoot: string,
  deps: { run: typeof runSpawn } = { run: runSpawn },
): Promise<CommandCheck> {
  const result = await deps.run(
    'pnpm',
    ['--filter', '@contentful/experience-design-system-cli-legacy', 'run', 'build'],
    { cwd: repoRoot },
  );
  return { passed: result.exitCode === 0, result };
}
