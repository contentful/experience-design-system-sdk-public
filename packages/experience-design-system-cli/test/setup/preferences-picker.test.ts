import { describe, expect, it } from 'vitest';
import {
  PREFERENCE_OPTIONS,
  formatPreferencePicker,
  parsePreferenceSelection,
} from '../../src/setup/preferences-picker.js';

describe('parsePreferenceSelection', () => {
  it('returns all options in display order', () => {
    expect(PREFERENCE_OPTIONS).toEqual([
      { key: 'autoFilter', number: 1, label: 'AI auto-filter' },
      { key: 'concurrency', number: 2, label: 'Performance concurrency' },
      { key: 'customPrompts', number: 3, label: 'Custom prompts' },
      { key: 'debug', number: 4, label: 'Debug logging' },
      { key: 'analytics', number: 5, label: 'Usage analytics' },
      { key: 'noColor', number: 6, label: 'Disable terminal colors' },
    ]);
    expect(parsePreferenceSelection('ALL')).toEqual(PREFERENCE_OPTIONS.map((option) => option.key));
  });

  it('skips preferences for blank input or s', () => {
    expect(parsePreferenceSelection('   ')).toEqual([]);
    expect(parsePreferenceSelection('S')).toEqual([]);
  });

  it('accepts comma-separated numbers in display order without duplicates', () => {
    expect(parsePreferenceSelection('5, 1, 5')).toEqual(['autoFilter', 'analytics']);
  });

  it.each(['0', '7', '1,,2', '1, custom prompts', 'all,1'])('rejects an invalid selection: %s', (input) => {
    expect(parsePreferenceSelection(input)).toBeUndefined();
  });
});

describe('formatPreferencePicker', () => {
  it('lists every preference along with all and skip shortcuts', () => {
    expect(formatPreferencePicker()).toBe(
      [
        'Choose preferences to configure:',
        '  [1] AI auto-filter',
        '  [2] Performance concurrency',
        '  [3] Custom prompts',
        '  [4] Debug logging',
        '  [5] Usage analytics',
        '  [6] Disable terminal colors',
        '  [all] Configure all',
        '  [s] Skip',
      ].join('\n'),
    );
  });
});
