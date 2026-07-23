import { describe, expect, it } from 'vitest';
import type { ComponentGraphNode } from '../../src/analyze/composite-closure.js';
import { findAllAncestors } from '../../src/analyze/search-neighborhood.js';

describe('findAllAncestors', () => {
  it('returns target + all transitive ancestors', () => {
    const graph: ComponentGraphNode[] = [
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', slots: [{ name: 's', allowedComponents: ['C'] }] },
      { name: 'C', slots: [] },
    ];
    const out = findAllAncestors('C', graph);
    expect([...out].sort()).toEqual(['A', 'B', 'C']);
  });

  it('root with no ancestors returns just the target', () => {
    const graph: ComponentGraphNode[] = [
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', slots: [] },
    ];
    const out = findAllAncestors('A', graph);
    expect([...out].sort()).toEqual(['A']);
  });

  it('handles cycles without infinite recursion', () => {
    const graph: ComponentGraphNode[] = [
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', slots: [{ name: 's', allowedComponents: ['A'] }] },
    ];
    const out = findAllAncestors('A', graph);
    expect([...out].sort()).toEqual(['A', 'B']);
  });
});
