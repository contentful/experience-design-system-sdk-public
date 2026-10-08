import { describe, expect, it } from 'vitest';
import { selectAllDescendants } from '../../src/controller/selection/select-all-descendants.js';
import { rejectAllAncestors } from '../../src/controller/selection/reject-all-ancestors.js';
import { findAllParents } from '../../src/controller/graph/find-all-parents.js';
import { expandMatchesByOneHop } from '../../src/controller/graph/expand-matches-by-one-hop.js';

const graph = [
  { name: 'A', slots: [{ name: 's', allowedComponents: ['B', 'C'] }] },
  { name: 'B', slots: [{ name: 's', allowedComponents: ['D'] }] },
  { name: 'C', slots: [] },
  { name: 'D', slots: [] },
];

describe('selectAllDescendants', () => {
  it('returns target + all forward-reachable nodes', () => {
    expect(selectAllDescendants({ target: 'A', graph })).toEqual(new Set(['A', 'B', 'C', 'D']));
  });
  it('returns just the target for a leaf', () => {
    expect(selectAllDescendants({ target: 'D', graph })).toEqual(new Set(['D']));
  });
});

describe('rejectAllAncestors', () => {
  it('returns target + all transitive parents', () => {
    expect(rejectAllAncestors({ target: 'D', graph })).toEqual(new Set(['D', 'B', 'A']));
  });
  it('returns just the target for a root', () => {
    expect(rejectAllAncestors({ target: 'A', graph })).toEqual(new Set(['A']));
  });
});

describe('findAllParents', () => {
  it('includes target itself and every transitive parent', () => {
    expect(findAllParents({ target: 'D', graph })).toEqual(new Set(['D', 'B', 'A']));
  });
});

describe('expandMatchesByOneHop', () => {
  it('expands by direct parents AND children in one hop', () => {
    // B's children: D. B's parents: A.
    expect(expandMatchesByOneHop({ matches: ['B'], graph })).toEqual(new Set(['A', 'B', 'D']));
  });
  it('returns the original set when empty', () => {
    expect(expandMatchesByOneHop({ matches: [], graph })).toEqual(new Set());
  });
});
