import { describe, expect, it } from 'vitest';
import { PREFERENCE_OPTIONS } from '../../src/setup/preferences-picker.js';

describe('PREFERENCE_OPTIONS', () => {
  it('lists every preference in display order', () => {
    expect(PREFERENCE_OPTIONS).toEqual([
      { key: 'autoFilter', label: 'AI auto-filter' },
      { key: 'concurrency', label: 'Performance concurrency' },
      { key: 'customPrompts', label: 'Custom prompts' },
      { key: 'debug', label: 'Debug logging' },
      { key: 'analytics', label: 'Usage analytics' },
      { key: 'noColor', label: 'Disable terminal colors' },
    ]);
  });
});
