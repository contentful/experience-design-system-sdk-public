import { describe, expect, it, vi } from 'vitest';
import {
  configureAutoFilter,
  promptAutoFilterPreference,
} from '../../../../src/setup/steps/preferences/auto-filter.js';
import { createDependencies, scripted } from '../dependencies.js';

describe('promptAutoFilterPreference', () => {
  it('defaults to true on empty input when current is undefined', async () => {
    const result = await promptAutoFilterPreference(scripted(['']), undefined);
    expect(result).toBe(true);
  });

  it("returns true on 'y' even when current is false", async () => {
    const result = await promptAutoFilterPreference(scripted(['y']), false);
    expect(result).toBe(true);
  });

  it("returns false on 'n' even when current is true", async () => {
    const result = await promptAutoFilterPreference(scripted(['n']), true);
    expect(result).toBe(false);
  });

  it('preserves existing preference (false) when input is empty', async () => {
    const result = await promptAutoFilterPreference(scripted(['']), false);
    expect(result).toBe(false);
  });
});

describe('configureAutoFilter', () => {
  it('persists a changed value and leaves an unchanged one alone', async () => {
    const writeCredentials = vi.fn();
    await configureAutoFilter(createDependencies({ ask: async () => 'n', writeCredentials }));
    expect(writeCredentials).toHaveBeenCalledWith(expect.objectContaining({ autoFilter: false }));

    const unchanged = vi.fn();
    await configureAutoFilter(createDependencies({ ask: async () => 'y', writeCredentials: unchanged }));
    expect(unchanged).not.toHaveBeenCalled();
  });

  it('leads with help text saying what the filter is for', async () => {
    const events: string[] = [];
    await configureAutoFilter(createDependencies({ write: (event) => events.push(`${event.kind}:${event.message}`) }));
    expect(events[0]).toBe('page:Filters out components irrelevant to experience orchestration during extraction.');
  });
});
