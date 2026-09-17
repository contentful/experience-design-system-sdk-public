import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PrerequisitesScreen } from '../../../../src/setup/steps/prerequisites/PrerequisitesScreen.js';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';

type Deps = NonNullable<React.ComponentProps<typeof PrerequisitesScreen>['deps']>;

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    nodeVersion: '24.18.1',
    homeDir: '/home/tester',
    binaryExists: async (binary) => binary === 'pnpm',
    pathExists: async () => false,
    run: async () => ({ exitCode: 0, stdout: '10.0.0\n', stderr: '' }),
    ...overrides,
  };
}

function setup(deps: Deps, skipBuild?: boolean) {
  const onDone = vi.fn();
  return {
    ...render(
      <PrerequisitesScreen
        repoRoot="/repo"
        {...(skipBuild !== undefined ? { skipBuild } : {})}
        onDone={onDone}
        deps={deps}
      />,
    ),
    onDone,
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150));

describe('PrerequisitesScreen', () => {
  it('reports each check as it finishes', async () => {
    const { frames } = setup(makeDeps());

    const history = await waitForFrame(
      () => frames.join('\n'),
      (f) => f.includes('CLI built successfully'),
    );

    expect(history).toContain('Node.js v24.18.1 — already good');
    expect(history).toContain('pnpm v10.0.0 — already installed');
    expect(history).toContain('Dependencies installed');
  });

  it('stops before install and build when skipBuild is set', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '10.0.0\n', stderr: '' });
    const { onDone } = setup(makeDeps({ run }), true);
    await settle();

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ node: { passed: true }, pnpm: { passed: true } }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('pnpm', ['--version']);
  });

  it('marks a Node version manager install as restart-required', async () => {
    const { lastFrame, stdin, onDone } = setup(makeDeps({ nodeVersion: '22.0.0', binaryExists: async () => false }));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Install nvm now?'),
    );
    stdin.write('y');
    await settle();

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ node: { passed: false, restartRequired: true } }));
  });

  it('reports no restart when the version manager install is declined', async () => {
    const { lastFrame, stdin, onDone } = setup(makeDeps({ nodeVersion: '22.0.0', binaryExists: async () => false }));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Install nvm now?'),
    );
    stdin.write('n');
    await settle();

    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ node: { passed: false } }));
  });

  it('offers corepack before npm when pnpm is missing', async () => {
    const { lastFrame } = setup(makeDeps({ binaryExists: async (binary) => binary === 'corepack' }));

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Install pnpm via corepack?'),
    );

    expect(frame).toContain('pnpm not found');
  });
});
