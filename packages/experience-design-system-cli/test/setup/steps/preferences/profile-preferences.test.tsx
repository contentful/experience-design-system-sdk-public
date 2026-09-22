import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NoColorScreen } from '../../../../src/setup/steps/preferences/no-color.js';
import type { StepDone } from '../../../../src/setup/steps/StepLayout.js';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';
import { choose } from '../select-helpers.js';

const shell = vi.hoisted(() => ({ profileContains: vi.fn(), appendToProfile: vi.fn() }));

vi.mock('../../../../src/setup/lib/shell.js', () => ({
  profileContains: shell.profileContains,
  appendToProfile: shell.appendToProfile,
}));

const PROFILE = '/home/tester/.zshrc';

function setup(Screen: React.ComponentType<{ profilePath: string; onDone: StepDone }>, alreadySet = false) {
  shell.profileContains.mockReset().mockResolvedValue(alreadySet);
  shell.appendToProfile.mockReset().mockResolvedValue(undefined);
  const onDone = vi.fn();
  return { ...render(<Screen profilePath={PROFILE} onDone={onDone} />), onDone, append: shell.appendToProfile };
}

describe('NoColorScreen', () => {
  it('appends NO_COLOR when the operator opts in', async () => {
    const { lastFrame, stdin, append } = setup(NoColorScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Terminal colors'),
    );
    await choose(stdin, lastFrame, 'Turn colors off');

    expect(append).toHaveBeenCalledWith(PROFILE, 'export NO_COLOR=1');
  });

  it('asks about the effect, not the variable name', async () => {
    const { lastFrame } = setup(NoColorScreen);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Terminal colors'),
    );

    expect(frame).not.toContain('NO_COLOR=1 (disable colors)');
  });
});
