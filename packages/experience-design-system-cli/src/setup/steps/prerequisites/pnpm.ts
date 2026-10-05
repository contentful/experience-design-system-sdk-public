import { checkPnpm } from '../../lib/checks.js';
import { emit, type PrerequisiteDeps, type PrerequisiteResult } from './deps.js';

export async function runPnpmSetup(dependencies: PrerequisiteDeps, repoRoot: string): Promise<PrerequisiteResult> {
  const detected = await checkPnpm(repoRoot, dependencies);
  if (detected.status === 'ok') {
    emit(dependencies, 'success', `pnpm v${detected.version} — already installed`);
    return { passed: true };
  }
  // pnpm is installed, so installing it again would not help. This is usually a
  // global store built against a different Node version.
  if (detected.status === 'unusable-in-repo') {
    emit(dependencies, 'failure', `pnpm v${detected.version} cannot run in the repo`);
    emit(dependencies, 'info', 'Its global store may not match your Node version. Fix: npm install -g pnpm --force');
    return { passed: false };
  }

  emit(dependencies, 'failure', 'pnpm not found');
  if (await dependencies.binaryExists('corepack')) {
    emit(dependencies, 'info', 'Will run: corepack enable && corepack prepare pnpm@latest --activate');
    if (await dependencies.confirm('Install pnpm via corepack?')) {
      const enabled = await dependencies.run('corepack', ['enable']);
      const installed =
        enabled.exitCode === 0 ? await dependencies.run('corepack', ['prepare', 'pnpm@latest', '--activate']) : enabled;
      if (installed.exitCode === 0) {
        emit(dependencies, 'success', 'pnpm installed via corepack');
        return { passed: true };
      }
      emit(dependencies, 'failure', 'corepack install failed');
      return { passed: false };
    }
  }

  emit(dependencies, 'info', 'Will run: npm install -g pnpm');
  if (!(await dependencies.confirm('Install pnpm via npm?'))) {
    emit(dependencies, 'warning', 'Skipped. Install pnpm manually: npm install -g pnpm');
    return { passed: false };
  }
  const result = await dependencies.run('npm', ['install', '-g', 'pnpm']);
  if (result.exitCode !== 0) {
    emit(dependencies, 'failure', 'npm install -g pnpm failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'pnpm installed');
  return { passed: true };
}
