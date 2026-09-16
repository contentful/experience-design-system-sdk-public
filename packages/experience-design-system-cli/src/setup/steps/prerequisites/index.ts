import type { PrerequisitesSetupResult, SetupActionDependencies } from '../../lib/types.js';
import { runBuildSetup } from './build.js';
import { runNodeSetup } from './node.js';
import { runPnpmSetup } from './pnpm.js';

export { runBuildSetup, runNodeSetup, runPnpmSetup };

export async function runPrerequisitesSetup(
  dependencies: SetupActionDependencies,
  repoRoot: string,
  options: { skipBuild?: boolean } = {},
): Promise<PrerequisitesSetupResult> {
  const node = await runNodeSetup(dependencies);
  if (!node.passed) return { node };

  const pnpm = await runPnpmSetup(dependencies);
  if (!pnpm.passed || options.skipBuild) return { node, pnpm };

  const build = await runBuildSetup(dependencies, repoRoot);
  return { node, pnpm, build };
}
