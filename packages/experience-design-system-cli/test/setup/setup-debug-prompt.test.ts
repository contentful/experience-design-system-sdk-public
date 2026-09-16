import { describe, it, expect } from 'vitest';
import { promptDebugModePreference } from '../src/setup/debug-mode-prompt.js';

describe('promptDebugModePreference', () => {
  it('defaults to OFF when no current value and empty answer', async () => {
    const ask = async () => '';
    expect(await promptDebugModePreference(ask, undefined)).toBe(false);
  });

  it('preserves current value on empty answer', async () => {
    const ask = async () => '';
    expect(await promptDebugModePreference(ask, true)).toBe(true);
    expect(await promptDebugModePreference(ask, false)).toBe(false);
  });

  it('parses yes and no', async () => {
    expect(await promptDebugModePreference(async () => 'y')).toBe(true);
    expect(await promptDebugModePreference(async () => 'Yes')).toBe(true);
    expect(await promptDebugModePreference(async () => 'n')).toBe(false);
    expect(await promptDebugModePreference(async () => 'No')).toBe(false);
  });

  it('shows [y/N] hint when currently OFF and [Y/n] when currently ON', async () => {
    let asked = '';
    const ask = async (q: string) => {
      asked = q;
      return '';
    };
    await promptDebugModePreference(ask, false);
    expect(asked).toContain('[y/N]');
    await promptDebugModePreference(ask, true);
    expect(asked).toContain('[Y/n]');
  });
});
