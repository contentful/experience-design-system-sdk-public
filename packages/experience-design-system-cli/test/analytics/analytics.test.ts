import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackEventMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/analytics/client.js', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
  analyticsEnabled: () => !process.env.DISABLE_ANALYTICS && Boolean(process.env.SEGMENT_WRITE_KEY),
  cliVersion: () => '2.23.0',
}));

import { normalizeCommand } from '../../src/analytics/normalize.js';
import { getOsName } from '../../src/analytics/os.js';
import {
  bindAnalyticsSession,
  completeActiveCommand,
  noteCommandStart,
  resetAnalyticsStateForTests,
} from '../../src/analytics/tracker.js';

describe('analytics normalizeCommand', () => {
  it('maps commander chains to tracked command ids', () => {
    expect(normalizeCommand('apply push')).toBe('apply_push');
    expect(normalizeCommand('analyze extract')).toBe('analyze_extract');
  });

  it('returns undefined for untracked commands', () => {
    expect(normalizeCommand('setup')).toBeUndefined();
    expect(normalizeCommand('session list')).toBeUndefined();
  });
});

describe('analytics getOsName', () => {
  it('maps darwin to macOS', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(getOsName()).toBe('macOS');
    Object.defineProperty(process, 'platform', { value: original });
  });
});

describe('analytics tracker', () => {
  beforeEach(() => {
    resetAnalyticsStateForTests();
    trackEventMock.mockReset().mockResolvedValue(undefined);
    delete process.env.DISABLE_ANALYTICS;
    process.env.SEGMENT_WRITE_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.SEGMENT_WRITE_KEY;
    delete process.env.DISABLE_ANALYTICS;
  });

  it('emits invoked then completed for a bound session', async () => {
    noteCommandStart('apply push');
    await bindAnalyticsSession('bold-cliff-a3f2', { space_key: 'space-1' });
    await completeActiveCommand();

    expect(trackEventMock).toHaveBeenCalledTimes(2);
    expect(trackEventMock.mock.calls[0]).toEqual([
      'dsi_cli_command_invoked',
      {
        dsi_session_id: 'bold-cliff-a3f2',
        command: 'apply_push',
        space_key: 'space-1',
      },
      'bold-cliff-a3f2',
    ]);
    expect(trackEventMock.mock.calls[1][0]).toBe('dsi_cli_command_completed');
    expect(trackEventMock.mock.calls[1][1]).toEqual(expect.objectContaining({ outcome: 'ok', command: 'apply_push' }));
  });
});
