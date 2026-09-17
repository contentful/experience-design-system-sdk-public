import { describe, expect, it, vi } from 'vitest';
import type { PrerequisiteDeps, PrerequisiteEvent } from '../../../../src/setup/steps/prerequisites/deps.js';
import { runPrerequisitesSetup } from '../../../../src/setup/steps/prerequisites/index.js';

/** The prerequisite checks with every side effect stubbed. */
function createDependencies(overrides: Partial<PrerequisiteDeps> = {}): PrerequisiteDeps {
  return {
    nodeVersion: '24.18.1',
    homeDir: '/home/tester',
    binaryExists: async (binary) => binary === 'pnpm',
    pathExists: async () => false,
    run: async () => ({ exitCode: 0, stdout: '10.0.0\n', stderr: '' }),
    confirm: async () => true,
    emit: () => undefined,
    ...overrides,
  };
}

describe('prerequisites step', () => {
  it('marks a successful fnm install as restart-required and reports failed activation recovery', async () => {
    const events: PrerequisiteEvent[] = [];
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    const dependencies = createDependencies({
      nodeVersion: '22.0.0',
      binaryExists: async (binary) => binary === 'fnm',
      run,
      emit: (event) => events.push(event),
    });

    await expect(runPrerequisitesSetup(dependencies, '/repo')).resolves.toEqual({
      node: { passed: false, restartRequired: true },
    });
    expect(events).toContainEqual({
      kind: 'warning',
      message: 'fnm use 24 failed — node installed but not activated',
    });
    expect(events).toContainEqual({
      kind: 'info',
      message: 'Run manually: fnm use 24 && fnm default 24',
    });
  });

  it('skips install and build when skipBuild is set after prerequisite checks', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '10.0.0\n', stderr: '' });
    const dependencies = createDependencies({ run });

    await expect(runPrerequisitesSetup(dependencies, '/repo', { skipBuild: true })).resolves.toEqual({
      node: { passed: true },
      pnpm: { passed: true },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('pnpm', ['--version']);
  });

  it('returns typed prerequisite results after installing dependencies and building the CLI', async () => {
    const events: PrerequisiteEvent[] = [];
    const dependencies = createDependencies({ emit: (event) => events.push(event) });

    await expect(runPrerequisitesSetup(dependencies, '/repo')).resolves.toEqual({
      node: { passed: true },
      pnpm: { passed: true },
      build: { passed: true },
    });
    expect(events).toContainEqual({ kind: 'success', message: 'CLI built successfully' });
  });
});
