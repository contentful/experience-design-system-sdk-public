import { describe, it, expect } from 'vitest';
import { indexRowsByKey } from '../../../../src/session/core/shared/index-rows-by-key.js';

describe('indexRowsByKey', () => {
  it('returns an empty map for an empty input', () => {
    expect(indexRowsByKey([], (x) => String(x)).size).toBe(0);
  });

  it('buckets items that share a key', () => {
    const groups = indexRowsByKey(
      [
        { id: 'a', v: 1 },
        { id: 'a', v: 2 },
        { id: 'b', v: 3 },
      ],
      (x) => x.id,
    );
    expect(groups.get('a')).toEqual([
      { id: 'a', v: 1 },
      { id: 'a', v: 2 },
    ]);
    expect(groups.get('b')).toEqual([{ id: 'b', v: 3 }]);
  });

  it('preserves input order within a bucket', () => {
    const groups = indexRowsByKey(
      [
        { id: 'x', v: 1 },
        { id: 'x', v: 2 },
        { id: 'x', v: 3 },
      ],
      (x) => x.id,
    );
    expect(groups.get('x')?.map((r) => r.v)).toEqual([1, 2, 3]);
  });
});
