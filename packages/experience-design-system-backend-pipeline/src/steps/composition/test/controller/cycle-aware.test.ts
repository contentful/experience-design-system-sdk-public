import { describe, expect, it } from 'vitest';
import { findSlotCycles } from '../../src/controller/cycles/find-slot-cycles.js';
import { groupNodesByCycleMembership } from '../../src/controller/cycles/group-nodes-by-cycle-membership.js';
import { selectDescendantsRespectingCycles } from '../../src/controller/selection/select-descendants-respecting-cycles.js';
import { rejectAncestorsRespectingCycles } from '../../src/controller/selection/reject-ancestors-respecting-cycles.js';
import { expandSeedsToIncludeCycleGroups } from '../../src/controller/selection/expand-seeds-to-include-cycle-groups.js';

// A ↔ B cycle; C is a child of A that doesn't participate.
const graph = [
  { name: 'A', slots: [{ name: 's', allowedComponents: ['B', 'C'] }] },
  { name: 'B', slots: [{ name: 's', allowedComponents: ['A'] }] },
  { name: 'C', slots: [] },
];

describe('groupNodesByCycleMembership', () => {
  it('groups cycle members into one shared set', () => {
    const cycles = findSlotCycles({ graph });
    const groups = groupNodesByCycleMembership({ cycles });
    const groupA = groups.get('A');
    const groupB = groups.get('B');
    expect(groupA).toBeDefined();
    expect(groupA).toBe(groupB);
    expect(groupA).toEqual(new Set(['A', 'B']));
    expect(groups.get('C')).toBeUndefined();
  });
});

describe('selectDescendantsRespectingCycles', () => {
  it('pulls the full cycle group when touching any member', () => {
    const cycles = findSlotCycles({ graph });
    const cycleGroups = groupNodesByCycleMembership({ cycles });
    const selection = selectDescendantsRespectingCycles({ target: 'A', graph, cycleGroups });
    expect(selection).toEqual(new Set(['A', 'B', 'C']));
  });
});

describe('rejectAncestorsRespectingCycles', () => {
  it('rejects cycle partners and marks their non-cycle descendants to deselect', () => {
    const cycles = findSlotCycles({ graph });
    const cycleGroups = groupNodesByCycleMembership({ cycles });
    const result = rejectAncestorsRespectingCycles({ target: 'A', graph, cycleGroups });
    expect(result.toReject).toEqual(new Set(['A', 'B']));
    expect(result.toDeselect).toEqual(new Set(['C']));
    expect(result.cyclePartners).toEqual(['B']);
  });
});

describe('expandSeedsToIncludeCycleGroups', () => {
  it('returns cycle groups reachable from the seed set', () => {
    const cycles = findSlotCycles({ graph });
    const cycleGroups = groupNodesByCycleMembership({ cycles });
    const reachable = expandSeedsToIncludeCycleGroups({ seeds: ['A'], graph, cycleGroups });
    expect(reachable).toEqual(new Set(['A', 'B']));
  });

  it('returns empty when there are no cycles', () => {
    const noCycleGraph = [{ name: 'A', slots: [] }];
    const cycles = findSlotCycles({ graph: noCycleGraph });
    const cycleGroups = groupNodesByCycleMembership({ cycles });
    expect(expandSeedsToIncludeCycleGroups({ seeds: ['A'], graph: noCycleGraph, cycleGroups })).toEqual(new Set());
  });
});
