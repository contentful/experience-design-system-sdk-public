import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConcurrencyScreen } from '../../../../src/setup/steps/preferences/concurrency.js';
import { NoColorScreen } from '../../../../src/setup/steps/preferences/no-color.js';
import type { StepDone } from '../../../../src/setup/steps/StepLayout.js';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';
import { acceptDefault, choose } from '../select-helpers.js';

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

describe('ConcurrencyScreen', () => {
  it('appends the variable when the operator opts in', async () => {
    const { lastFrame, stdin, onDone, append } = setup(ConcurrencyScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );
    await choose(stdin, lastFrame, 'Analyze more components at once');

    expect(append).toHaveBeenCalledWith(PROFILE, '# experiences performance\nexport EDS_EXTRACT_CONCURRENCY=8');
    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('writes nothing when the operator declines', async () => {
    const { lastFrame, stdin, onDone, append } = setup(ConcurrencyScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );
    await acceptDefault(stdin);

    expect(append).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('explains an already-set variable and waits instead of returning on its own', async () => {
    const { lastFrame, onDone, append } = setup(ConcurrencyScreen, true);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('already set'),
    );

    expect(frame).toContain(`EDS_EXTRACT_CONCURRENCY is already set in ${PROFILE}`);
    expect(frame).toContain('Remove that line from your profile');
    expect(append).not.toHaveBeenCalled();
    // The screen stays put so the operator can read it; it only reports back
    // once they choose Back.
    expect(onDone).not.toHaveBeenCalled();
  });

  it('returns to the caller when the operator leaves an already-set variable', async () => {
    const { lastFrame, stdin, onDone, append } = setup(ConcurrencyScreen, true);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('already set'),
    );
    await acceptDefault(stdin);

    expect(append).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('describes the effect rather than the variable in the prompt', async () => {
    const { lastFrame } = setup(ConcurrencyScreen);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Performance concurrency'),
    );

    expect(frame).not.toContain('EDS_EXTRACT_CONCURRENCY=8 to your profile');
  });
});

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
