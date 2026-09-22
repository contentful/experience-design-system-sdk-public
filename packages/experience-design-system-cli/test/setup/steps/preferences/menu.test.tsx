import { describe, expect, it } from 'vitest';
import { PREFERENCE_OPTIONS } from '../../../../src/setup/steps/preferences/index.js';
import { summarisePreferences } from '../../../../src/setup/steps/preferences/PreferencesMenu.js';

const NO_PROFILE = { concurrency: false, noColor: false };

describe('PREFERENCE_OPTIONS', () => {
  it('lists every preference in the order the menu shows them', () => {
    expect(PREFERENCE_OPTIONS.map((option) => option.key)).toEqual([
      'autoFilter',
      'concurrency',
      'customPrompts',
      'debug',
      'analytics',
      'noColor',
    ]);
  });

  it('pairs every preference with a label and a screen', () => {
    for (const option of PREFERENCE_OPTIONS) {
      expect(option.label).toBeTruthy();
      expect(typeof option.Screen).toBe('function');
    }
  });
});

describe('summarisePreferences', () => {
  it('describes the defaults an untouched install runs with, all marked default', () => {
    const summary = summarisePreferences({ spaceId: '', environmentId: '', cmaToken: '' }, NO_PROFILE);

    expect(summary).toEqual({
      autoFilter: { text: 'Filtering irrelevant components', state: 'default' },
      concurrency: { text: 'Default', state: 'default' },
      customPrompts: { text: 'Built-in prompts', state: 'default' },
      debug: { text: 'Quiet', state: 'default' },
      analytics: { text: 'Sharing usage data', state: 'default' },
      noColor: { text: 'Colors on', state: 'default' },
    });
  });

  it('marks credential preferences moved off their default as changed', () => {
    const summary = summarisePreferences(
      {
        spaceId: '',
        environmentId: '',
        cmaToken: '',
        autoFilter: false,
        debug: true,
        analyticsDisabled: true,
      },
      NO_PROFILE,
    );

    expect(summary.autoFilter).toEqual({ text: 'Keeping every component', state: 'changed' });
    expect(summary.debug).toEqual({ text: 'Verbose traces', state: 'changed' });
    expect(summary.analytics).toEqual({ text: 'Not sharing usage data', state: 'changed' });
  });

  it('treats a stored value equal to the default as unchanged', () => {
    // autoFilter defaults to on, so an explicit `true` is still the default.
    const summary = summarisePreferences(
      { spaceId: '', environmentId: '', cmaToken: '', autoFilter: true, debug: false },
      NO_PROFILE,
    );

    expect(summary.autoFilter.state).toBe('default');
    expect(summary.debug.state).toBe('default');
  });

  it('reports profile-backed preferences from the shell profile, not the credentials', () => {
    const summary = summarisePreferences(
      { spaceId: '', environmentId: '', cmaToken: '' },
      { concurrency: true, noColor: true },
    );

    expect(summary.concurrency).toEqual({ text: 'More components at once', state: 'changed' });
    expect(summary.noColor).toEqual({ text: 'Colors off', state: 'changed' });
  });

  it('counts how many custom prompt paths are set', () => {
    const base = { spaceId: '', environmentId: '', cmaToken: '' };

    expect(summarisePreferences({ ...base, selectPromptPath: '/tmp/s.md' }, NO_PROFILE).customPrompts).toEqual({
      text: 'One custom prompt',
      state: 'changed',
    });
    expect(
      summarisePreferences({ ...base, selectPromptPath: '/tmp/s.md', generatePromptPath: '/tmp/g.md' }, NO_PROFILE)
        .customPrompts,
    ).toEqual({ text: 'Custom select and generate', state: 'changed' });
  });
});
