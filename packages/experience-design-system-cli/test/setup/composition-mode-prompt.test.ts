import { describe, it, expect } from 'vitest';
import {
  promptCompositeModePreference,
  promptAgenticResolutionPreference,
} from '../../src/setup/composition-mode-prompt.js';

const ask = (answer: string) => async () => answer;

describe('promptCompositeModePreference (T10)', () => {
  it('defaults to atomic (composite OFF) on empty input', async () => {
    expect(await promptCompositeModePreference(ask(''))).toBe('atomic');
  });

  it('returns composite on yes', async () => {
    expect(await promptCompositeModePreference(ask('y'))).toBe('composite');
    expect(await promptCompositeModePreference(ask('Yes'))).toBe('composite');
  });

  it('returns atomic on no', async () => {
    expect(await promptCompositeModePreference(ask('n'))).toBe('atomic');
  });

  it('honors the current preference on empty input', async () => {
    expect(await promptCompositeModePreference(ask(''), 'composite')).toBe('composite');
    expect(await promptCompositeModePreference(ask(''), 'atomic')).toBe('atomic');
  });

  it('unknown input falls back to the default/current', async () => {
    expect(await promptCompositeModePreference(ask('maybe'))).toBe('atomic');
    expect(await promptCompositeModePreference(ask('maybe'), 'composite')).toBe('composite');
  });
});

describe('promptAgenticResolutionPreference (T10)', () => {
  it('defaults OFF (opt-in) on empty input', async () => {
    expect(await promptAgenticResolutionPreference(ask(''))).toBe(false);
  });

  it('returns true on yes, false on no', async () => {
    expect(await promptAgenticResolutionPreference(ask('y'))).toBe(true);
    expect(await promptAgenticResolutionPreference(ask('n'))).toBe(false);
  });

  it('honors current on empty', async () => {
    expect(await promptAgenticResolutionPreference(ask(''), true)).toBe(true);
  });
});
