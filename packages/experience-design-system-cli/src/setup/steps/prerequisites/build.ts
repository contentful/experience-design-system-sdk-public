import { emit, type PrerequisiteDeps, type PrerequisiteResult } from './deps.js';

export async function runBuildSetup(dependencies: PrerequisiteDeps, repoRoot: string): Promise<PrerequisiteResult> {
  emit(dependencies, 'info', 'Running pnpm install...');
  const install = await dependencies.run('pnpm', ['install', '--frozen-lockfile'], { cwd: repoRoot });
  if (install.exitCode !== 0) {
    emit(dependencies, 'failure', 'pnpm install failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'Dependencies installed');
  emit(dependencies, 'info', 'Building CLI...');
  const build = await dependencies.run(
    'pnpm',
    ['--filter', '@contentful/experience-design-system-cli', 'run', 'build'],
    { cwd: repoRoot },
  );
  if (build.exitCode !== 0) {
    emit(dependencies, 'failure', 'Build failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'CLI built successfully');
  return { passed: true };
}
