import { buildCli, installDependencies } from '../../lib/checks.js';
import { emit, type PrerequisiteDeps, type PrerequisiteResult } from './deps.js';

export async function runBuildSetup(dependencies: PrerequisiteDeps, repoRoot: string): Promise<PrerequisiteResult> {
  emit(dependencies, 'info', 'Running pnpm install...');
  const install = await installDependencies(repoRoot, dependencies);
  if (!install.passed) {
    emit(dependencies, 'failure', 'pnpm install failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'Dependencies installed');

  emit(dependencies, 'info', 'Building CLI...');
  const build = await buildCli(repoRoot, dependencies);
  if (!build.passed) {
    emit(dependencies, 'failure', 'Build failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'CLI built successfully');
  return { passed: true };
}
