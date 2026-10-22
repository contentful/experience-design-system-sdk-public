import { describe, expect, it } from 'vitest';
import { flattenTokens, windowStart } from '../../../../../src/tui/import/steps/05-token-review/logic.js';

describe('flattenTokens', () => {
  it('walks groups, inherits $type and formats composite values', () => {
    const rows = flattenTokens({
      $description: 'ignored',
      color: { $type: 'color', brand: { primary: { $value: '#0059c8' } } },
      space: { sm: { $type: 'dimension', $value: '4px' } },
      shadow: { card: { $type: 'shadow', $value: { offsetX: '0px' } } },
    });
    expect(rows).toEqual([
      { path: 'color.brand.primary', type: 'color', value: '#0059c8' },
      { path: 'space.sm', type: 'dimension', value: '4px' },
      { path: 'shadow.card', type: 'shadow', value: '{"offsetX":"0px"}' },
    ]);
  });

  it('returns nothing for a non-object file', () => {
    expect(flattenTokens(null)).toEqual([]);
    expect(flattenTokens([1])).toEqual([]);
  });
});

describe('windowStart', () => {
  it('keeps the selection inside the window', () => {
    expect(windowStart(0, 0, 5, 20)).toBe(0);
    expect(windowStart(7, 0, 5, 20)).toBe(3);
    expect(windowStart(2, 5, 5, 20)).toBe(2);
    expect(windowStart(19, 0, 5, 20)).toBe(15);
  });
});
