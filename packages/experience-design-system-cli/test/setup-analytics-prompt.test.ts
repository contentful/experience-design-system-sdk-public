import { describe, it, expect } from 'vitest';
import { promptAnalyticsPreference } from '../src/setup/analytics-prompt.js';

describe('promptAnalyticsPreference', () => {
  it('defaults to enabled (not disabled) when no current value and empty answer', async () => {
    const ask = async () => '';
    expect(await promptAnalyticsPreference(ask, undefined)).toBe(false);
  });

  it('preserves current value on empty answer', async () => {
    const ask = async () => '';
    expect(await promptAnalyticsPreference(ask, true)).toBe(true);
    expect(await promptAnalyticsPreference(ask, false)).toBe(false);
  });

  it('parses yes and no', async () => {
    expect(await promptAnalyticsPreference(async () => 'y')).toBe(true);
    expect(await promptAnalyticsPreference(async () => 'Yes')).toBe(true);
    expect(await promptAnalyticsPreference(async () => 'n')).toBe(false);
    expect(await promptAnalyticsPreference(async () => 'No')).toBe(false);
  });

  it('shows [y/N] hint when currently enabled and [Y/n] hint when currently disabled', async () => {
    let asked = '';
    const ask = async (q: string) => {
      asked = q;
      return '';
    };
    await promptAnalyticsPreference(ask, false);
    expect(asked).toContain('[y/N]');
    await promptAnalyticsPreference(ask, true);
    expect(asked).toContain('[Y/n]');
  });
});
