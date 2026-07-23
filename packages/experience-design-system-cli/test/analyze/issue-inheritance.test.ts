import { describe, it, expect } from 'vitest';
import { computeRenderStatuses, pickDrillTarget } from '../../src/analyze/issue-inheritance.js';
import { computeClosure, type ComponentGraphNode, type NodeStatus } from '../../src/analyze/composite-closure.js';

function comp(name: string, slots: Array<[string, string[]]> = []): ComponentGraphNode {
  return {
    name,
    slots: slots.map(([slotName, allowed]) => ({ name: slotName, allowedComponents: allowed })),
  };
}

describe('computeRenderStatuses', () => {
  it('returns empty map when there are no direct issues', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B')];
    const closure = computeClosure('A', components);
    const out = computeRenderStatuses(closure, new Map());
    expect(out.size).toBe(0);
  });

  it('marks leaf as own issue and ancestor as inherited', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B')];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([['B', 'warning']]);
    const out = computeRenderStatuses(closure, direct);

    expect(out.get('B')).toEqual({
      status: 'warning',
      isOwn: true,
      sourceComponents: ['B'],
    });
    expect(out.get('A')).toEqual({
      status: 'warning',
      isOwn: false,
      sourceComponents: ['B'],
    });
  });

  it('propagates two direct issues at different depths to common ancestors', () => {
    const components = [
      comp('A', [
        ['s1', ['B']],
        ['s2', ['D']],
      ]),
      comp('B', [['x', ['C']]]),
      comp('C'),
      comp('D'),
    ];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([
      ['C', 'warning'],
      ['D', 'error'],
    ]);
    const out = computeRenderStatuses(closure, direct);

    expect(out.get('C')).toEqual({
      status: 'warning',
      isOwn: true,
      sourceComponents: ['C'],
    });
    expect(out.get('D')).toEqual({
      status: 'error',
      isOwn: true,
      sourceComponents: ['D'],
    });
    expect(out.get('B')).toEqual({
      status: 'warning',
      isOwn: false,
      sourceComponents: ['C'],
    });
    expect(out.get('A')).toEqual({
      status: 'error',
      isOwn: false,
      sourceComponents: ['C', 'D'],
    });
  });

  it('aggregates warning + error in different branches to error at root', () => {
    const components = [
      comp('A', [
        ['s1', ['B']],
        ['s2', ['C']],
      ]),
      comp('B'),
      comp('C'),
    ];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([
      ['B', 'warning'],
      ['C', 'error'],
    ]);
    const out = computeRenderStatuses(closure, direct);

    expect(out.get('A')).toEqual({
      status: 'error',
      isOwn: false,
      sourceComponents: ['B', 'C'],
    });
  });

  it('does not include clean ancestors', () => {
    const components = [comp('A'), comp('B')];
    // A closure only contains A (no deps). Neither has issues.
    const closure = computeClosure('A', components);
    const out = computeRenderStatuses(closure, new Map());
    expect(out.has('A')).toBe(false);
  });

  it('includes standalone node with own issue and no descendants', () => {
    const components = [comp('X')];
    const closure = computeClosure('X', components);
    const direct = new Map<string, NodeStatus>([['X', 'error']]);
    const out = computeRenderStatuses(closure, direct);
    expect(out.get('X')).toEqual({
      status: 'error',
      isOwn: true,
      sourceComponents: ['X'],
    });
  });
});

describe('pickDrillTarget', () => {
  it('returns null when the ancestor has its own issue', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B')];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([['A', 'warning']]);
    expect(pickDrillTarget('A', closure, direct)).toBeNull();
  });

  it('returns the descendant when there is a single inherited source', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B')];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([['B', 'warning']]);
    expect(pickDrillTarget('A', closure, direct)).toBe('B');
  });

  it('picks the worst-status descendant first', () => {
    const components = [
      comp('A', [
        ['s1', ['B']],
        ['s2', ['C']],
      ]),
      comp('B'),
      comp('C'),
    ];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([
      ['B', 'warning'],
      ['C', 'error'],
    ]);
    expect(pickDrillTarget('A', closure, direct)).toBe('C');
  });

  it('picks the shorter path among two same-status descendants', () => {
    const components = [
      comp('A', [
        ['s1', ['B']],
        ['s2', ['C']],
      ]),
      comp('B', [['x', ['D']]]),
      comp('C'),
      comp('D'),
    ];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([
      ['D', 'error'],
      ['C', 'error'],
    ]);
    expect(pickDrillTarget('A', closure, direct)).toBe('C');
  });

  it('breaks equal-path ties alphabetically', () => {
    const components = [
      comp('A', [
        ['s1', ['Z']],
        ['s2', ['B']],
      ]),
      comp('Z'),
      comp('B'),
    ];
    const closure = computeClosure('A', components);
    const direct = new Map<string, NodeStatus>([
      ['Z', 'error'],
      ['B', 'error'],
    ]);
    expect(pickDrillTarget('A', closure, direct)).toBe('B');
  });

  it('returns null when the ancestor has no descendants with issues', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B')];
    const closure = computeClosure('A', components);
    expect(pickDrillTarget('A', closure, new Map())).toBeNull();
  });
});
