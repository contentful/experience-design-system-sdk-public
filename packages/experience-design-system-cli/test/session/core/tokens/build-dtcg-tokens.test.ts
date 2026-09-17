import { describe, it, expect } from 'vitest';
import { buildDtcgTokens } from '../../../../src/session/core/tokens/build-dtcg-tokens.js';

describe('buildDtcgTokens', () => {
  it('returns [] when there are no token rows', () => {
    expect(buildDtcgTokens([])).toEqual([]);
  });

  it('parses token values as JSON', () => {
    const tokens = buildDtcgTokens([
      { path: 'color.brand.primary', type: 'color', value: '"#ff0000"', description: null },
    ]);
    expect(tokens[0]?.$value).toBe('#ff0000');
  });

  it('propagates token descriptions when present', () => {
    const tokens = buildDtcgTokens([{ path: 'x', type: 'color', value: '"#f00"', description: 'red' }]);
    expect(tokens[0]?.$description).toBe('red');
  });

  it('omits $description when the row has null description', () => {
    const tokens = buildDtcgTokens([{ path: 'x', type: 'color', value: '"#f00"', description: null }]);
    expect(tokens[0]).not.toHaveProperty('$description');
  });
});
