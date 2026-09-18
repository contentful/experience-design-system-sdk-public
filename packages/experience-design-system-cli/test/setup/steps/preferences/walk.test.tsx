import { describe, expect, it } from 'vitest';
import { PREFERENCE_OPTIONS } from '../../../../src/setup/steps/preferences/index.js';

describe('PREFERENCE_OPTIONS', () => {
  it('lists every preference in the order the wizard walks them', () => {
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
