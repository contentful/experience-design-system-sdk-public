import { describe, expect, it } from 'vitest';
import { isPlainSourceContract } from '../../../../../src/steps/extraction/source-closure/validation.js';

describe('isPlainSourceContract', () => {
  it('accepts plain JSON values, null-prototype records and dense arrays', () => {
    const bare = Object.assign(Object.create(null), { name: 'value' });
    expect(isPlainSourceContract({ text: 'a', count: 1, flag: false, empty: null, list: [1, { nested: ['x'] }] })).toBe(
      true,
    );
    expect(isPlainSourceContract(bare)).toBe(true);
    const shared = { value: 1 };
    expect(isPlainSourceContract([shared, shared])).toBe(true);
  });

  it('rejects non-finite numbers, non-plain objects and non-JSON values', () => {
    for (const value of [Number.NaN, Infinity, undefined, () => 1, 1n, new Date(0), new Map(), Symbol('s')])
      expect(isPlainSourceContract(value)).toBe(false);
    expect(isPlainSourceContract({ nested: { value: undefined } })).toBe(false);
  });

  it('rejects cycles, sparse or extended arrays, symbol keys and accessors', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = [1, 2, 3];
    delete sparse[1];
    const extended = Object.assign([1], { extra: true });
    const symbolic = { [Symbol('key')]: 1 };
    const accessor = Object.defineProperty({}, 'value', { get: () => 1, enumerable: true });
    const hidden = Object.defineProperty({}, 'value', { value: 1, enumerable: false });
    for (const value of [cyclic, sparse, extended, symbolic, accessor, hidden])
      expect(isPlainSourceContract(value)).toBe(false);
  });
});
