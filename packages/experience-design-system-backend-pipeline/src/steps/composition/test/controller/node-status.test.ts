import { describe, expect, it } from 'vitest';
import { propagateDescendantIssuesToAncestors } from '../../src/controller/selection/propagate-descendant-issues-to-ancestors.js';
import { findWorstIssuedDescendant } from '../../src/controller/selection/find-worst-issued-descendant.js';
import type { Closure } from '../../src/types/graph.js';

const closure: Closure = {
  root: 'A',
  containsCycle: false,
  nodes: [
    { name: 'A', depth: 0, path: ['A'], parents: [] },
    { name: 'B', depth: 1, path: ['A', 'B'], parents: ['A'] },
    { name: 'C', depth: 2, path: ['A', 'B', 'C'], parents: ['B'] },
  ],
};

describe('propagateDescendantIssuesToAncestors', () => {
  it("surfaces a descendant's error up to its ancestors as inherited", () => {
    const directIssues = new Map([['C', 'error' as const]]);
    const statuses = propagateDescendantIssuesToAncestors({ closure, directIssues });
    expect(statuses.get('C')).toEqual({ status: 'error', isOwn: true, sourceComponents: ['C'] });
    expect(statuses.get('B')).toEqual({ status: 'error', isOwn: false, sourceComponents: ['C'] });
    expect(statuses.get('A')).toEqual({ status: 'error', isOwn: false, sourceComponents: ['C'] });
  });
});

describe('findWorstIssuedDescendant', () => {
  it('returns the deepest issued descendant of an ancestor whose issue is inherited', () => {
    const directIssues = new Map([['C', 'error' as const]]);
    expect(findWorstIssuedDescendant({ ancestor: 'A', closure, directIssues })).toBe('C');
  });

  it('returns null when the ancestor has its own issue (no drill-down needed)', () => {
    const directIssues = new Map([
      ['A', 'error' as const],
      ['C', 'warning' as const],
    ]);
    expect(findWorstIssuedDescendant({ ancestor: 'A', closure, directIssues })).toBeNull();
  });
});
