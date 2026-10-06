import { describe, it, expect } from 'vitest';
import { parsePrecomputedCachedNames } from '../../../src/generate/helpers/load-session-data.js';

describe('parsePrecomputedCachedNames', () => {
  it('returns empty set for undefined', () => {
    expect(parsePrecomputedCachedNames(undefined).size).toBe(0);
  });

  it('returns empty set for invalid JSON', () => {
    expect(parsePrecomputedCachedNames('not-json').size).toBe(0);
  });

  it('returns empty set for non-array JSON', () => {
    expect(parsePrecomputedCachedNames('{"a":1}').size).toBe(0);
  });

  it('parses a JSON array of strings', () => {
    const result = parsePrecomputedCachedNames('["Button","Card"]');
    expect(result.has('Button')).toBe(true);
    expect(result.has('Card')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('filters out non-string entries', () => {
    const result = parsePrecomputedCachedNames('["Button", 42, null, "Card"]');
    expect(result.size).toBe(2);
    expect(result.has('Button')).toBe(true);
    expect(result.has('Card')).toBe(true);
  });
});
