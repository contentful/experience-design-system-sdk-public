import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ExperiencesCredentials } from '../../../../src/credentials-store.js';
import { AnalyticsScreen } from '../../../../src/setup/steps/preferences/analytics.js';
import { AutoFilterScreen } from '../../../../src/setup/steps/preferences/auto-filter.js';
import { DebugScreen } from '../../../../src/setup/steps/preferences/debug.js';
import type { StepDone } from '../../../../src/setup/steps/StepLayout.js';
import { waitForFrame } from '../../../helpers/wait-for-frame.js';
import { acceptDefault, choose } from '../select-helpers.js';

const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));

vi.mock('../../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

const EMPTY: ExperiencesCredentials = { spaceId: '', environmentId: '', cmaToken: '' };

function setup(Screen: React.ComponentType<{ onDone: StepDone }>, stored: ExperiencesCredentials = EMPTY) {
  store.read.mockReset().mockResolvedValue(stored);
  store.write.mockReset().mockResolvedValue(undefined);
  const onDone = vi.fn();
  return { ...render(<Screen onDone={onDone} />), onDone, write: store.write };
}

describe('AutoFilterScreen', () => {
  it('defaults to on, so confirming changes nothing', async () => {
    const { lastFrame, stdin, onDone, write } = setup(AutoFilterScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AI auto-filter'),
    );
    await acceptDefault(stdin);

    expect(write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('persists the opt-out when the operator picks the other option', async () => {
    const { lastFrame, stdin, onDone, write } = setup(AutoFilterScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AI auto-filter'),
    );
    await choose(stdin, lastFrame, 'Keep every component');

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ autoFilter: false }));
    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('says what the filter is for, below the prompt', async () => {
    const { lastFrame } = setup(AutoFilterScreen);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Filters out components'),
    );

    const lines = frame.split('\n');
    const prompt = lines.findIndex((line) => line.includes('AI auto-filter'));
    const help = lines.findIndex((line) => line.includes('Filters out components'));
    expect(help).toBeGreaterThan(prompt);
  });

  it('offers to turn the filter back on when it is stored off', async () => {
    const { lastFrame, stdin, write } = setup(AutoFilterScreen, { ...EMPTY, autoFilter: false });
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('AI auto-filter'),
    );
    await choose(stdin, lastFrame, 'Use AI to filter out irrelevant components');

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ autoFilter: true }));
  });
});

describe('DebugScreen', () => {
  it('defaults to off, so declining changes nothing', async () => {
    const { lastFrame, stdin, onDone, write } = setup(DebugScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Debug logging'),
    );
    await acceptDefault(stdin);

    expect(write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('persists debug logging when the operator opts in', async () => {
    const { lastFrame, stdin, write } = setup(DebugScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Debug logging'),
    );
    await choose(stdin, lastFrame, 'Write verbose traces');

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ debug: true }));
  });
});

describe('AnalyticsScreen', () => {
  it('asks whether to disable, and keeps analytics on by default', async () => {
    const { lastFrame, stdin, onDone, write } = setup(AnalyticsScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Anonymous usage analytics'),
    );
    await acceptDefault(stdin);

    expect(write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('skipped');
  });

  it('persists the opt-out when the operator disables analytics', async () => {
    const { lastFrame, stdin, write } = setup(AnalyticsScreen);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Anonymous usage analytics'),
    );
    await choose(stdin, lastFrame, "Don't share usage data");

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ analyticsDisabled: true }));
  });
});
