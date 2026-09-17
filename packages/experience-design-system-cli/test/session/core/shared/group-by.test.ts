import { describe, it, expect } from 'vitest';
import { groupBy } from '../../../../src/session/core/shared/group-by.js';

describe('groupBy', () => {
  it('returns an empty map for an empty input', () => {
    expect(groupBy([], (x) => String(x)).size).toBe(0);
  });

  it('groups items sharing a key', () => {
    const groups = groupBy(
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

  it('preserves input order within a group', () => {
    const groups = groupBy(
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
