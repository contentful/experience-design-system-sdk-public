import { describe, expect, it } from 'vitest';
import { computeColumnWindow, flattenTokens } from '../../../../../src/tui/import/steps/05-token-review/logic.js';

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

describe('computeColumnWindow', () => {
  it('shows everything when it fits', () => {
    expect(computeColumnWindow(3, 2, 5)).toEqual({ start: 0, end: 3, above: 0, below: 0 });
  });

  it('keeps the cursor inside the window and counts the rows cut off', () => {
    expect(computeColumnWindow(20, 0, 5)).toEqual({ start: 0, end: 5, above: 0, below: 15 });
    expect(computeColumnWindow(20, 10, 5)).toEqual({ start: 8, end: 13, above: 8, below: 7 });
    expect(computeColumnWindow(20, 19, 5)).toEqual({ start: 15, end: 20, above: 15, below: 0 });
  });
});
