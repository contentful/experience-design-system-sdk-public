import { describe, expect, it } from 'vitest';
import { findSlotCycles } from '../../src/controller/cycles/find-slot-cycles.js';

describe('findSlotCycles', () => {
  it('returns empty for a graph without cycles', () => {
    const result = findSlotCycles({
      graph: [
        { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
        { name: 'B', slots: [] },
      ],
    });
    expect(result).toEqual([]);
  });

  it('detects a self-loop as a single-node cycle', () => {
    const result = findSlotCycles({
      graph: [{ name: 'A', slots: [{ name: 's', allowedComponents: ['A'] }] }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toEqual(['A', 'A']);
  });

  it('detects a 2-node cycle A→B→A', () => {
    const result = findSlotCycles({
      graph: [
        { name: 'A', slots: [{ name: 's1', allowedComponents: ['B'] }] },
        { name: 'B', slots: [{ name: 's2', allowedComponents: ['A'] }] },
      ],
    });
    expect(result).toHaveLength(1);
    const cycle = result[0];
    expect(cycle.path[0]).toEqual(cycle.path[cycle.path.length - 1]);
  });

  it('ignores edges to unknown components', () => {
    const result = findSlotCycles({
      graph: [{ name: 'A', slots: [{ name: 's', allowedComponents: ['Unknown'] }] }],
    });
    expect(result).toEqual([]);
  });
});
