import { describe, it, expect } from 'vitest';
import { promptAutoFilterPreference } from '../../src/setup/auto-filter-prompt.js';

function scripted(answers: string[]): (q: string) => Promise<string> {
  let i = 0;
  return async () => {
    const next = answers[i] ?? '';
    i += 1;
    return next;
  };
}

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
