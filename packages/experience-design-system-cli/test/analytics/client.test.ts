import { afterEach, describe, expect, it } from 'vitest';
import {
  analyticsEnabled,
  resetAnalyticsClientForTests,
  setPersistedAnalyticsDisabled,
} from '../../src/analytics/client.js';

describe('analyticsEnabled', () => {
  afterEach(() => {
    delete process.env.DISABLE_ANALYTICS;
    delete process.env.SEGMENT_WRITE_KEY;
    resetAnalyticsClientForTests();
  });

  it('is false when no write key is configured', () => {
    delete process.env.SEGMENT_WRITE_KEY;
    expect(analyticsEnabled()).toBe(false);
  });

  it('is true when a write key is configured and nothing disables it', () => {
    process.env.SEGMENT_WRITE_KEY = 'test-key';
    expect(analyticsEnabled()).toBe(true);
  });

  it('is false when the persisted setup preference disables it, even with a write key', () => {
    process.env.SEGMENT_WRITE_KEY = 'test-key';
    setPersistedAnalyticsDisabled(true);
    expect(analyticsEnabled()).toBe(false);
  });

  it('stays disabled when the persisted preference is set, regardless of DISABLE_ANALYTICS', () => {
    process.env.SEGMENT_WRITE_KEY = 'test-key';
    setPersistedAnalyticsDisabled(true);
    delete process.env.DISABLE_ANALYTICS;
    expect(analyticsEnabled()).toBe(false);
  });

  it('resetAnalyticsClientForTests clears the persisted disable flag', () => {
    process.env.SEGMENT_WRITE_KEY = 'test-key';
    setPersistedAnalyticsDisabled(true);
    resetAnalyticsClientForTests();
    expect(analyticsEnabled()).toBe(true);
  });
});
