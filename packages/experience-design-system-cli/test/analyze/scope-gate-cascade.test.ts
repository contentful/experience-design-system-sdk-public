import { describe, it, expect } from 'vitest';
import {
  buildCycleUnits,
  collectReachableCycleUnits,
  computeCycleAwareAcceptCascade,
  computeCycleAwareRejectCascade,
} from '../../src/analyze/scope-gate-cascade.js';
import type { ComponentGraphNode } from '../../src/analyze/composite-closure.js';
import { findSlotCycles } from '../../src/analyze/cycle-detection.js';

function comp(name: string, slots: Array<[string, string[]]> = []): ComponentGraphNode {
  return {
    name,
    slots: slots.map(([slotName, allowed]) => ({ name: slotName, allowedComponents: allowed })),
  };
}

function unitsFor(graph: ComponentGraphNode[]): Map<string, Set<string>> {
  return buildCycleUnits(findSlotCycles(graph));
}

describe('buildCycleUnits', () => {
  it('returns empty for graphs without cycles', () => {
    const graph = [comp('Article', [['body', ['Card']]]), comp('Card')];
    expect(buildCycleUnits(findSlotCycles(graph)).size).toBe(0);
  });

  it('groups every member of a 2-cycle into the same unit', () => {
    const graph = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const units = unitsFor(graph);
    expect(units.get('A')).toEqual(new Set(['A', 'B']));
    expect(units.get('B')).toEqual(new Set(['A', 'B']));
    expect(units.get('A')).toBe(units.get('B'));
  });

  it('collapses two cycles sharing a node into a single unit', () => {
    const graph = [
      comp('A', [['s', ['B']]]),
      comp('B', [
        ['sa', ['A']],
        ['sc', ['C']],
      ]),
      comp('C', [['s', ['B']]]),
    ];
    const units = unitsFor(graph);
    expect(units.get('A')).toEqual(new Set(['A', 'B', 'C']));
    expect(units.get('B')).toEqual(new Set(['A', 'B', 'C']));
    expect(units.get('C')).toEqual(new Set(['A', 'B', 'C']));
  });
});

describe('computeCycleAwareAcceptCascade', () => {
  it('accepts every member of the cycle when target is a cycle member', () => {
    const graph = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const units = unitsFor(graph);
    expect([...computeCycleAwareAcceptCascade('A', graph, units)].sort()).toEqual(['A', 'B']);
  });

  it('accepts every non-cycle descendant of every cycle member (full closure)', () => {
    const graph = [
      comp('A', [
        ['cycle', ['B']],
        ['aux', ['Leaf1']],
      ]),
      comp('B', [
        ['cycle', ['A']],
        ['aux', ['Leaf2']],
      ]),
      comp('Leaf1'),
      comp('Leaf2'),
    ];
    const units = unitsFor(graph);
    expect([...computeCycleAwareAcceptCascade('A', graph, units)].sort()).toEqual(['A', 'B', 'Leaf1', 'Leaf2']);
  });

  it('accepts ancestor + entire cycle when accepting an ancestor that slots a cycle member', () => {
    const graph = [comp('Wrapper', [['s', ['A']]]), comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const units = unitsFor(graph);
    expect([...computeCycleAwareAcceptCascade('Wrapper', graph, units)].sort()).toEqual(['A', 'B', 'Wrapper']);
  });

  it('traverses through nested composite → shared-interior → cycle', () => {
    const graph = [
      comp('Wrapper', [['s', ['SharedInterior']]]),
      comp('SharedInterior', [['s', ['InnerA']]]),
      comp('InnerA', [['s', ['InnerB']]]),
      comp('InnerB', [['s', ['InnerA']]]),
    ];
    const units = unitsFor(graph);
    expect([...computeCycleAwareAcceptCascade('Wrapper', graph, units)].sort()).toEqual([
      'InnerA',
      'InnerB',
      'SharedInterior',
      'Wrapper',
    ]);
  });

  it('is idempotent on repeated calls', () => {
    const graph = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const units = unitsFor(graph);
    const once = computeCycleAwareAcceptCascade('A', graph, units);
    const twice = computeCycleAwareAcceptCascade('A', graph, units);
    expect([...once].sort()).toEqual([...twice].sort());
  });
});

describe('computeCycleAwareRejectCascade', () => {
  it('rejects every member of the cycle + ancestors referencing any member', () => {
    const graph = [comp('Wrapper', [['s', ['A']]]), comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const units = unitsFor(graph);
    const { toReject } = computeCycleAwareRejectCascade('A', graph, units);
    expect([...toReject].sort()).toEqual(['A', 'B', 'Wrapper']);
  });

  it('rejects non-cycle ancestor alone; leaves cycle members untouched by reject', () => {
    const graph = [comp('Wrapper', [['s', ['A']]]), comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const units = unitsFor(graph);
    const { toReject, toDeselect } = computeCycleAwareRejectCascade('Wrapper', graph, units);
    expect(toReject).toEqual(new Set(['Wrapper']));
    expect([...toDeselect].sort()).toEqual(['A', 'B']);
  });

  it('non-cycle descendants deselect to undecided when parent is rejected', () => {
    const graph = [comp('Root', [['s', ['Mid']]]), comp('Mid', [['s', ['Leaf']]]), comp('Leaf')];
    const units = unitsFor(graph);
    const { toReject, toDeselect } = computeCycleAwareRejectCascade('Mid', graph, units);
    expect([...toReject].sort()).toEqual(['Mid', 'Root']);
    expect(toDeselect).toEqual(new Set(['Leaf']));
  });

  it('cyclePartners surfaces the other cycle members when target is in a cycle', () => {
    const graph = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const units = unitsFor(graph);
    const { cyclePartners } = computeCycleAwareRejectCascade('A', graph, units);
    expect(cyclePartners).toEqual(['B']);
  });

  it('cyclePartners is empty for a non-cycle target', () => {
    const graph = [comp('X')];
    const units = unitsFor(graph);
    expect(computeCycleAwareRejectCascade('X', graph, units).cyclePartners).toEqual([]);
  });
});

describe('collectReachableCycleUnits', () => {
  it('returns empty when seeds do not reach any cycle', () => {
    const graph = [comp('Root', [['s', ['Leaf']]]), comp('Leaf')];
    const units = unitsFor(graph);
    expect([...collectReachableCycleUnits(['Root'], graph, units)]).toEqual([]);
  });

  it('emits the full cycle unit for any seed whose slot-closure reaches a cycle member', () => {
    const graph = [
      comp('Wrapper', [['s', ['A']]]),
      comp('A', [['s', ['B']]]),
      comp('B', [['s', ['A']]]),
      comp('Standalone'),
    ];
    const units = unitsFor(graph);
    expect([...collectReachableCycleUnits(['Wrapper', 'Standalone'], graph, units)].sort()).toEqual(['A', 'B']);
  });
});
