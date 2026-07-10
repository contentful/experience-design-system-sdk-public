import { describe, expect, it } from 'vitest';
import type { ComponentGraphNode } from '../../src/analyze/composite-closure.js';
import { findAllAncestors } from '../../src/analyze/search-neighborhood.js';

// T5 — `findAllAncestors` is a reverse-BFS walk over `slots[].allowedComponents`
// edges. Returns the target + every composite that transitively slots it. Used
// by the step-level jump-and-filter `[i]` handler to build a `filterVisibleKeys`
// set (see plan §B T5).

describe('findAllAncestors', () => {
  it('returns target + all transitive ancestors', () => {
    // A slots B slots C (target). Ancestors of C: {A, B}. Result: {A,B,C}.
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
    // A ↔ B cycle. Target A: A itself + B (which slots A).
    const graph: ComponentGraphNode[] = [
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', slots: [{ name: 's', allowedComponents: ['A'] }] },
    ];
    const out = findAllAncestors('A', graph);
    expect([...out].sort()).toEqual(['A', 'B']);
  });
});
