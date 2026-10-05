import { describe, expect, it } from 'vitest';
import { resolveExtractNoCache } from '../../src/analyze/extract-command.js';

describe('resolveExtractNoCache', () => {
  it('recognizes Commander’s negated --no-cache option', () => {
    expect(resolveExtractNoCache({ cache: false })).toBe(true);
  });

  it('keeps extraction cached by default', () => {
    expect(resolveExtractNoCache({ cache: true })).toBe(false);
    expect(resolveExtractNoCache({})).toBe(false);
  });

  it('supports the normalized noCache form for direct callers', () => {
    expect(resolveExtractNoCache({ noCache: true })).toBe(true);
  });
});
