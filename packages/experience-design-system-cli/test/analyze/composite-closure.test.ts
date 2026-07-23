import { describe, it, expect } from 'vitest';
import {
  findRoots,
  computeClosure,
  computeAllClosures,
  aggregateStatus,
  findSharedDeps,
  type ComponentGraphNode,
  type NodeStatus,
} from '../../src/analyze/composite-closure.js';

function comp(name: string, slots: Array<[string, string[]]> = []): ComponentGraphNode {
  return {
    name,
    slots: slots.map(([slotName, allowed]) => ({ name: slotName, allowedComponents: allowed })),
  };
}

describe('findRoots', () => {
  it('returns empty on empty input', () => {
    expect(findRoots([])).toEqual([]);
  });

  it('returns both when two components are independent', () => {
    const components = [comp('A'), comp('B')];
    expect(findRoots(components).sort()).toEqual(['A', 'B']);
  });

  it('returns only the parent when A depends on B', () => {
    const components = [comp('A', [['slot', ['B']]]), comp('B')];
    expect(findRoots(components)).toEqual(['A']);
  });

  it('returns only the top of a diamond', () => {
    const components = [
      comp('A', [
        ['s1', ['B']],
        ['s2', ['C']],
      ]),
      comp('B', [['x', ['D']]]),
      comp('C', [['y', ['D']]]),
      comp('D'),
    ];
    expect(findRoots(components)).toEqual(['A']);
  });

  it('treats components outside the selected set as external', () => {
    const components = [comp('A', [['slot', ['B']]]), comp('B')];
    const roots = findRoots(components, new Set(['A']));
    expect(roots).toEqual(['A']);
  });

  it('returns sorted names deterministically', () => {
    const components = [comp('Zeta'), comp('Alpha'), comp('Mid')];
    expect(findRoots(components)).toEqual(['Alpha', 'Mid', 'Zeta']);
  });
});

describe('computeClosure', () => {
  it('returns a standalone leaf with a single node at depth 0', () => {
    const components = [comp('A')];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(false);
    expect(closure.root).toBe('A');
    expect(closure.nodes).toHaveLength(1);
    expect(closure.nodes[0]).toEqual({ name: 'A', depth: 0, path: ['A'], parents: [] });
  });

  it('walks a linear A -> B -> C chain with correct depth and path', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['C']]]), comp('C')];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(false);
    const byName = new Map(closure.nodes.map((n) => [n.name, n]));
    expect(byName.get('A')).toEqual({ name: 'A', depth: 0, path: ['A'], parents: [] });
    expect(byName.get('B')).toEqual({ name: 'B', depth: 1, path: ['A', 'B'], parents: ['A'] });
    expect(byName.get('C')).toEqual({ name: 'C', depth: 2, path: ['A', 'B', 'C'], parents: ['B'] });
  });

  it('deduplicates diamond shape: shared dep with two parents at shortest depth', () => {
    const components = [
      comp('A', [
        ['s1', ['B']],
        ['s2', ['C']],
      ]),
      comp('B', [['x', ['D']]]),
      comp('C', [['y', ['D']]]),
      comp('D'),
    ];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(false);
    expect(closure.nodes.filter((n) => n.name === 'D')).toHaveLength(1);
    const d = closure.nodes.find((n) => n.name === 'D')!;
    expect(d.depth).toBe(2);
    expect(d.parents.sort()).toEqual(['B', 'C']);
    expect(d.path).toEqual(['A', 'B', 'D']);
  });

  it('deduplicates when short and long path collide: shortest depth wins', () => {
    const components = [
      comp('A', [
        ['s1', ['B']],
        ['s2', ['C']],
      ]),
      comp('C', [['x', ['B']]]),
      comp('B'),
    ];
    const closure = computeClosure('A', components);
    const b = closure.nodes.find((n) => n.name === 'B')!;
    expect(b.depth).toBe(1);
    expect(b.path).toEqual(['A', 'B']);
    expect(b.parents.sort()).toEqual(['A', 'C']);
  });

  it('flags a 2-cycle', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(true);
    expect(closure.cyclePath).toBeDefined();
    expect(closure.cyclePath!.length).toBeGreaterThanOrEqual(3);
    const nodes = closure.cyclePath!.slice(0, -1);
    expect(new Set(nodes)).toEqual(new Set(['A', 'B']));
    expect(closure.cyclePath![0]).toBe(closure.cyclePath![closure.cyclePath!.length - 1]);
  });

  it('flags a self-loop', () => {
    const components = [comp('A', [['s', ['A']]])];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(true);
    expect(closure.cyclePath).toEqual(['A', 'A']);
  });

  it('ignores edges to unknown external components', () => {
    const components = [comp('A', [['s', ['External']]])];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(false);
    expect(closure.nodes).toHaveLength(1);
    expect(closure.nodes[0].name).toBe('A');
  });

  it('flags cycle even when cycle is downstream of the root', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['C']]]), comp('C', [['s', ['B']]])];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(true);
  });

  it('returns a closure for a root not defined in components as a standalone node with no cycle', () => {
    const closure = computeClosure('Missing', [comp('A')]);
    expect(closure.containsCycle).toBe(false);
    expect(closure.nodes).toEqual([{ name: 'Missing', depth: 0, path: ['Missing'], parents: [] }]);
  });

  it('includes both cycle members as nodes when root is part of a 2-cycle', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const closure = computeClosure('A', components);
    expect(closure.containsCycle).toBe(true);
    const names = new Set(closure.nodes.map((n) => n.name));
    expect(names).toEqual(new Set(['A', 'B']));
  });

  it('includes all reachable nodes when root is outside the cycle (Wrapper1 topology)', () => {
    // Wrapper1 → SharedInterior → InnerA ↔ InnerB
    // Root is Wrapper1 which is NOT part of the cycle; cycle is downstream.
    const components = [
      comp('Wrapper1', [['s', ['SharedInterior']]]),
      comp('SharedInterior', [['s', ['InnerA']]]),
      comp('InnerA', [['s', ['InnerB']]]),
      comp('InnerB', [['s', ['InnerA']]]),
    ];
    const closure = computeClosure('Wrapper1', components);
    expect(closure.containsCycle).toBe(true);
    const names = new Set(closure.nodes.map((n) => n.name));
    expect(names).toEqual(new Set(['Wrapper1', 'SharedInterior', 'InnerA', 'InnerB']));
  });

  it('includes all reachable nodes when root is a non-root non-cycle member (SharedInterior topology)', () => {
    const components = [
      comp('Wrapper1', [['s', ['SharedInterior']]]),
      comp('SharedInterior', [['s', ['InnerA']]]),
      comp('InnerA', [['s', ['InnerB']]]),
      comp('InnerB', [['s', ['InnerA']]]),
    ];
    const closure = computeClosure('SharedInterior', components);
    expect(closure.containsCycle).toBe(true);
    const names = new Set(closure.nodes.map((n) => n.name));
    expect(names).toEqual(new Set(['SharedInterior', 'InnerA', 'InnerB']));
  });
});

describe('computeAllClosures', () => {
  it('returns one closure per root', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B'), comp('C')];
    const all = computeAllClosures(components);
    expect([...all.keys()].sort()).toEqual(['A', 'C']);
    expect(
      all
        .get('A')!
        .nodes.map((n) => n.name)
        .sort(),
    ).toEqual(['A', 'B']);
    expect(all.get('C')!.nodes.map((n) => n.name)).toEqual(['C']);
  });

  it('includes shared deps in every root closure that owns them', () => {
    const components = [comp('R1', [['s', ['Shared']]]), comp('R2', [['s', ['Shared']]]), comp('Shared')];
    const all = computeAllClosures(components);
    expect([...all.keys()].sort()).toEqual(['R1', 'R2']);
    expect(
      all
        .get('R1')!
        .nodes.map((n) => n.name)
        .sort(),
    ).toEqual(['R1', 'Shared']);
    expect(
      all
        .get('R2')!
        .nodes.map((n) => n.name)
        .sort(),
    ).toEqual(['R2', 'Shared']);
  });

  it('respects the selected filter for root discovery', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B'), comp('C')];
    const all = computeAllClosures(components, new Set(['A']));
    expect([...all.keys()]).toEqual(['A']);
  });
});

describe('aggregateStatus', () => {
  const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['C']]]), comp('C')];
  const closure = computeClosure('A', components);

  it('returns ok when no statuses are provided', () => {
    expect(aggregateStatus(closure, new Map())).toBe<NodeStatus>('ok');
  });

  it('returns warning when the closure has warnings but no errors', () => {
    const statuses = new Map<string, NodeStatus>([['B', 'warning']]);
    expect(aggregateStatus(closure, statuses)).toBe<NodeStatus>('warning');
  });

  it('returns error when any node in the closure errors', () => {
    const statuses = new Map<string, NodeStatus>([
      ['B', 'warning'],
      ['C', 'error'],
    ]);
    expect(aggregateStatus(closure, statuses)).toBe<NodeStatus>('error');
  });

  it('ignores statuses for nodes outside the closure', () => {
    const statuses = new Map<string, NodeStatus>([['Z', 'error']]);
    expect(aggregateStatus(closure, statuses)).toBe<NodeStatus>('ok');
  });
});

describe('findSharedDeps', () => {
  it('returns empty map when no dep is shared', () => {
    const components = [comp('A', [['s', ['B']]]), comp('C'), comp('B')];
    const all = computeAllClosures(components);
    expect(findSharedDeps(all).size).toBe(0);
  });

  it('returns shared deps with sorted root names', () => {
    const components = [comp('R2', [['s', ['Shared']]]), comp('R1', [['s', ['Shared']]]), comp('Shared')];
    const all = computeAllClosures(components);
    const shared = findSharedDeps(all);
    expect([...shared.keys()]).toEqual(['Shared']);
    expect(shared.get('Shared')).toEqual(['R1', 'R2']);
  });

  it('does not include a dep that only appears under one root', () => {
    const components = [comp('R1', [['s', ['OnlyMine']]]), comp('OnlyMine'), comp('R2')];
    const all = computeAllClosures(components);
    expect(findSharedDeps(all).has('OnlyMine')).toBe(false);
  });
});
