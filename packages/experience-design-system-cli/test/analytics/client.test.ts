import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constructorCalls: Array<{ writeKey: string }> = [];

vi.mock('@segment/analytics-node', () => ({
  Analytics: class {
    constructor(options: { writeKey: string }) {
      constructorCalls.push(options);
    }
    on() {}
    track() {}
    async closeAndFlush() {}
  },
}));

import {
  analyticsEnabled,
  resetAnalyticsClientForTests,
  setPersistedAnalyticsDisabled,
  trackEvent,
} from '../../src/analytics/client.js';

const PUBLIC_WRITE_KEY = '6DmxiEPN3SV1vbRTTMcNqDzCvkfwT06N';

describe('analyticsEnabled', () => {
  afterEach(() => {
    delete process.env.DISABLE_ANALYTICS;
    delete process.env.SEGMENT_WRITE_KEY;
    resetAnalyticsClientForTests();
  });

  it('is true with no SEGMENT_WRITE_KEY set, falling back to the built-in public key', () => {
    delete process.env.SEGMENT_WRITE_KEY;
    expect(analyticsEnabled()).toBe(true);
  });

  it('is true when a write key is configured and nothing disables it', () => {
    process.env.SEGMENT_WRITE_KEY = 'test-key';
    expect(analyticsEnabled()).toBe(true);
  });

  it('is false when DISABLE_ANALYTICS is set', () => {
    process.env.DISABLE_ANALYTICS = '1';
    expect(analyticsEnabled()).toBe(false);
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

describe('write key resolution', () => {
  beforeEach(() => {
    constructorCalls.length = 0;
    resetAnalyticsClientForTests();
  });

  afterEach(() => {
    delete process.env.SEGMENT_WRITE_KEY;
    resetAnalyticsClientForTests();
  });

  it('uses the built-in public write key when SEGMENT_WRITE_KEY is unset', async () => {
    delete process.env.SEGMENT_WRITE_KEY;
    await trackEvent('dsi_cli_session_started', {}, 'anon-1');
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0].writeKey).toBe(PUBLIC_WRITE_KEY);
  });

  it('lets SEGMENT_WRITE_KEY override the built-in key for local staging runs', async () => {
    process.env.SEGMENT_WRITE_KEY = 'staging-key';
    await trackEvent('dsi_cli_session_started', {}, 'anon-1');
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0].writeKey).toBe('staging-key');
  });

  it('falls back to the built-in key when SEGMENT_WRITE_KEY is blank', async () => {
    process.env.SEGMENT_WRITE_KEY = '   ';
    await trackEvent('dsi_cli_session_started', {}, 'anon-1');
    expect(constructorCalls[0].writeKey).toBe(PUBLIC_WRITE_KEY);
  });
});
