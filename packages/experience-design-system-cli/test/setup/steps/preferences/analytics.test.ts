import { describe, expect, it, vi } from 'vitest';
import { configureAnalytics, promptAnalyticsPreference } from '../../../../src/setup/steps/preferences/analytics.js';
import { createDependencies } from '../dependencies.js';

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

describe('configureAnalytics', () => {
  it('persists the opt-out when the operator disables analytics', async () => {
    const writeCredentials = vi.fn();
    await configureAnalytics(createDependencies({ ask: async () => 'y', writeCredentials }));
    expect(writeCredentials).toHaveBeenCalledWith(expect.objectContaining({ analyticsDisabled: true }));
  });
});
