import { describe, it, expect } from 'vitest';
import { computeCycleAutoRejectTargets } from '../../src/import/cycle-auto-reject.js';
import type { ComponentGraphNode } from '../../src/analyze/composite-closure.js';

describe('computeCycleAutoRejectTargets', () => {
  it('returns the cycle participant and its ancestors', () => {
    const graph: ComponentGraphNode[] = [
      {
        name: 'A',
        slots: [{ name: 'default', allowedComponents: ['B'] }],
      },
      {
        name: 'B',
        slots: [],
      },
    ];
    const slotCycles = [{ path: ['B', 'A', 'B'] }];
    const result = computeCycleAutoRejectTargets(slotCycles, graph);
    expect(result).toBeInstanceOf(Set);
    expect(result.has('B')).toBe(true);
    expect(result.has('A')).toBe(true);
  });

  it('returns empty set when slotCycles is empty', () => {
    const graph: ComponentGraphNode[] = [
      { name: 'A', slots: [{ name: 'default', allowedComponents: ['B'] }] },
      { name: 'B', slots: [] },
    ];
    const result = computeCycleAutoRejectTargets([], graph);
    expect(result.size).toBe(0);
  });

  it('returns only the direct participant when it has no ancestors', () => {
    const graph: ComponentGraphNode[] = [{ name: 'Solo', slots: [] }];
    const result = computeCycleAutoRejectTargets([{ path: ['Solo', 'Solo'] }], graph);
    expect(result.has('Solo')).toBe(true);
    expect(result.size).toBe(1);
  });
});
