import { checkNodeVersion, detectNodeVersionManagers } from '../../lib/checks.js';
import { REQUIRED_NODE_MAJOR } from '../../lib/shell.js';
import { emit, type SetupActionDependencies, type SetupCheckResult } from '../../lib/types.js';

export async function runNodeSetup(
  dependencies: SetupActionDependencies,
): Promise<SetupCheckResult & { restartRequired?: boolean }> {
  const check = checkNodeVersion(dependencies.nodeVersion);
  if (check.passed) {
    emit(dependencies, 'success', `Node.js v${check.version} — already good`);
    return { passed: true };
  }

  emit(dependencies, 'failure', `Node.js v${check.version} — need v${check.required}+`);
  const { nvm: hasNvm, fnm: hasFnm, nvmScript } = await detectNodeVersionManagers(dependencies.homeDir, dependencies);

  if (hasNvm) {
    emit(
      dependencies,
      'info',
      `nvm detected. Will run: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}`,
    );
    if (!(await dependencies.confirm(`Install and switch to Node ${REQUIRED_NODE_MAJOR} via nvm?`))) {
      emit(
        dependencies,
        'warning',
        `Skipped. Re-run experiences setup after switching to Node ${REQUIRED_NODE_MAJOR}.`,
      );
      return { passed: false };
    }
    const result = await dependencies.run('bash', [
      '-c',
      `source "${nvmScript}" && nvm install ${REQUIRED_NODE_MAJOR} && nvm alias default ${REQUIRED_NODE_MAJOR}`,
    ]);
    if (result.exitCode !== 0) {
      emit(dependencies, 'failure', 'nvm install failed');
      emit(dependencies, 'info', `Run manually: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}`);
      return { passed: false };
    }
    emit(
      dependencies,
      'success',
      `Node ${REQUIRED_NODE_MAJOR} installed via nvm. Re-run experiences setup in a fresh shell to pick it up.`,
    );
    return { passed: false, restartRequired: true };
  }

  if (hasFnm) {
    emit(
      dependencies,
      'info',
      `fnm detected. Will run: fnm install ${REQUIRED_NODE_MAJOR} && fnm use ${REQUIRED_NODE_MAJOR}`,
    );
    if (!(await dependencies.confirm(`Install and switch to Node ${REQUIRED_NODE_MAJOR} via fnm?`))) {
      emit(
        dependencies,
        'warning',
        `Skipped. Re-run experiences setup after switching to Node ${REQUIRED_NODE_MAJOR}.`,
      );
      return { passed: false };
    }
    const install = await dependencies.run('fnm', ['install', String(REQUIRED_NODE_MAJOR)]);
    if (install.exitCode !== 0) {
      emit(dependencies, 'failure', 'fnm install failed');
      return { passed: false };
    }
    const useResult = await dependencies.run('fnm', ['use', String(REQUIRED_NODE_MAJOR)]);
    if (useResult.exitCode !== 0) {
      emit(dependencies, 'warning', `fnm use ${REQUIRED_NODE_MAJOR} failed — node installed but not activated`);
      emit(dependencies, 'info', `Run manually: fnm use ${REQUIRED_NODE_MAJOR} && fnm default ${REQUIRED_NODE_MAJOR}`);
    } else {
      const defaultResult = await dependencies.run('fnm', ['default', String(REQUIRED_NODE_MAJOR)]);
      if (defaultResult.exitCode !== 0) {
        emit(
          dependencies,
          'warning',
          `fnm default ${REQUIRED_NODE_MAJOR} failed — version won't persist across new shells`,
        );
        emit(dependencies, 'info', `Run manually: fnm default ${REQUIRED_NODE_MAJOR}`);
      }
    }
    emit(
      dependencies,
      'success',
      `Node ${REQUIRED_NODE_MAJOR} installed via fnm. Re-run experiences setup in a fresh shell.`,
    );
    return { passed: false, restartRequired: true };
  }

  emit(dependencies, 'info', 'No Node version manager detected (nvm or fnm).');
  if (!(await dependencies.confirm('Install nvm now? (recommended)'))) {
    emit(dependencies, 'info', `Install Node ${REQUIRED_NODE_MAJOR} manually from https://nodejs.org`);
    return { passed: false };
  }
  const result = await dependencies.run('bash', [
    '-c',
    'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash',
  ]);
  if (result.exitCode !== 0) {
    emit(dependencies, 'failure', 'nvm install failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'nvm installed. Open a new shell, then re-run experiences setup.');
  return { passed: false, restartRequired: true };
}
