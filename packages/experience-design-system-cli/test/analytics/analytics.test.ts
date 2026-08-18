import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackEventMock = vi.fn().mockResolvedValue(undefined);
const flushAnalyticsMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/analytics/client.js', () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
  flushAnalytics: () => flushAnalyticsMock(),
  analyticsEnabled: () => !process.env.DISABLE_ANALYTICS && Boolean(process.env.SEGMENT_WRITE_KEY),
  cliVersion: () => '2.23.0',
  resetAnalyticsClientForTests: () => undefined,
}));

import { normalizeCommand } from '../../src/analytics/normalize.js';
import { getOsName } from '../../src/analytics/os.js';
import { ANALYTICS_SESSION_ENV, IMPORT_PIPELINE_ENV } from '../../src/analytics/constants.js';
import { resolveAnalyticsSessionId } from '../../src/analytics/session.js';
import {
  bindAnalyticsSession,
  bindAnalyticsSessionId,
  completeActiveCommand,
  failActiveCommand,
  noteCommandStart,
  resetAnalyticsStateForTests,
} from '../../src/analytics/tracker.js';

describe('analytics normalizeCommand', () => {
  it('maps commander chains to tracked command ids', () => {
    expect(normalizeCommand('apply push')).toBe('apply_push');
    expect(normalizeCommand('analyze extract')).toBe('analyze_extract');
    expect(normalizeCommand('analyze select-agent')).toBe('analyze_select');
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

describe('analytics session resolution', () => {
  afterEach(() => {
    delete process.env[ANALYTICS_SESSION_ENV];
  });

  it('prefers the pipeline parent session id from the environment', () => {
    process.env[ANALYTICS_SESSION_ENV] = 'import-session-a';
    expect(resolveAnalyticsSessionId('extract-session-b')).toBe('import-session-a');
  });

  it('falls back to an explicit session id', () => {
    expect(resolveAnalyticsSessionId('extract-session-b')).toBe('extract-session-b');
  });
});

describe('analytics tracker', () => {
  beforeEach(() => {
    resetAnalyticsStateForTests();
    trackEventMock.mockReset().mockResolvedValue(undefined);
    flushAnalyticsMock.mockReset().mockResolvedValue(undefined);
    delete process.env.DISABLE_ANALYTICS;
    delete process.env[IMPORT_PIPELINE_ENV];
    process.env.SEGMENT_WRITE_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.SEGMENT_WRITE_KEY;
    delete process.env.DISABLE_ANALYTICS;
    delete process.env[IMPORT_PIPELINE_ENV];
    delete process.env[ANALYTICS_SESSION_ENV];
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
      { flush: true },
    ]);
    expect(trackEventMock.mock.calls[1][0]).toBe('dsi_cli_command_completed');
    expect(trackEventMock.mock.calls[1][1]).toEqual(expect.objectContaining({ outcome: 'ok', command: 'apply_push' }));
    expect(trackEventMock.mock.calls[1][3]).toEqual({ flush: true });
  });

  it('inherits the pipeline session id when binding', async () => {
    process.env[ANALYTICS_SESSION_ENV] = 'import-session-a';
    process.env[IMPORT_PIPELINE_ENV] = '1';
    noteCommandStart('analyze extract');
    const id = await bindAnalyticsSessionId('extract-session-b');
    expect(id).toBe('import-session-a');
    await completeActiveCommand();
    expect(trackEventMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ dsi_session_id: 'import-session-a', is_pipeline_step: true }),
    );
  });

  it('marks subprocess commands as pipeline steps', async () => {
    process.env[IMPORT_PIPELINE_ENV] = '1';
    noteCommandStart('generate components');
    await bindAnalyticsSession('import-session-a');
    await completeActiveCommand();
    expect(trackEventMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ is_pipeline_step: true, command: 'generate_components' }),
    );
  });

  it('emits failed with structured fields', async () => {
    noteCommandStart('apply push');
    await bindAnalyticsSession('bold-cliff-a3f2');
    await failActiveCommand({ exit_code: 1, http_status_code: 422, error_name: 'ApiError' });

    expect(trackEventMock).toHaveBeenCalledTimes(2);
    expect(trackEventMock.mock.calls[1][0]).toBe('dsi_cli_command_failed');
    expect(trackEventMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        outcome: 'error',
        exit_code: 1,
        http_status_code: 422,
        error_name: 'ApiError',
      }),
    );
  });

  it('does not emit terminal events before invoked', async () => {
    noteCommandStart('apply push');
    await completeActiveCommand();
    expect(trackEventMock).not.toHaveBeenCalled();
  });
});
