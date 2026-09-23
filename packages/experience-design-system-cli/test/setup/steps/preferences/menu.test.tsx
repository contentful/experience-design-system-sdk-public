import { describe, expect, it } from 'vitest';
import { PREFERENCE_OPTIONS } from '../../../../src/setup/steps/preferences/index.js';
import { summarisePreferences } from '../../../../src/setup/steps/preferences/PreferencesMenu.js';

describe('PREFERENCE_OPTIONS', () => {
  it('lists every preference in the order the menu shows them', () => {
    expect(PREFERENCE_OPTIONS.map((option) => option.key)).toEqual([
      'autoFilter',
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
  it('describes the defaults an untouched install runs with', () => {
    const summary = summarisePreferences({ spaceId: '', environmentId: '', cmaToken: '' });

    expect(summary).toEqual({
      autoFilter: 'Filtering out irrelevant components',
      customPrompts: 'Built-in prompts',
      debug: 'Quiet',
      analytics: 'Sharing usage data',
      noColor: 'Colors on',
    });
  });

  it('reports stored credential preferences', () => {
    const summary = summarisePreferences({
      spaceId: '',
      environmentId: '',
      cmaToken: '',
      autoFilter: false,
      debug: true,
      analyticsDisabled: true,
    });

    expect(summary.autoFilter).toBe('Keeping every component');
    expect(summary.debug).toBe('Verbose traces');
    expect(summary.analytics).toBe('Not sharing usage data');
  });

  it('reports the stored color preference from the credentials file', () => {
    const summary = summarisePreferences({ spaceId: '', environmentId: '', cmaToken: '', noColor: true });

    expect(summary.noColor).toBe('Colors off');
  });

  it('counts how many custom prompt paths are set', () => {
    const base = { spaceId: '', environmentId: '', cmaToken: '' };

    expect(summarisePreferences({ ...base, selectPromptPath: '/tmp/s.md' }).customPrompts).toBe('One custom prompt');
    expect(
      summarisePreferences({ ...base, selectPromptPath: '/tmp/s.md', generatePromptPath: '/tmp/g.md' }).customPrompts,
    ).toBe('Custom select and generate');
  });
});
