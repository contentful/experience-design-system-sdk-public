import { describe, it, expect } from 'vitest';
import {
  findSlotCycles,
  formatCyclePath,
  suggestCycleBreakEdge,
  type ComponentSlotInfo,
  type SlotCycle,
} from '../../src/analyze/cycle-detection.js';

function comp(name: string, slots: Array<[string, string[]]>): ComponentSlotInfo {
  return {
    name,
    slots: slots.map(([slotName, allowed]) => ({ name: slotName, allowedComponents: allowed })),
  };
}

/**
 * Compare cycles ignoring the cyclic rotation start point — a cycle A→B→A
 * and B→A→B are the same elementary cycle. Normalize by rotating so the
 * lexicographically-smallest node is first, then compare paths.
 */
function normalizeCyclePath(cycle: SlotCycle): string {
  const nodes = cycle.path.slice(0, -1); // drop repeated last element
  if (nodes.length === 0) return '';
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i += 1) {
    if (nodes[i] < nodes[minIdx]) minIdx = i;
  }
  const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
  return rotated.join('>');
}

describe('findSlotCycles', () => {
  it('returns empty on empty input', () => {
    expect(findSlotCycles([])).toEqual([]);
  });

  it('returns empty when no cycles exist', () => {
    const components = [
      comp('CardA', [['header', ['CardB']]]),
      comp('CardB', [['body', ['Heading']]]),
      comp('Heading', []),
    ];
    expect(findSlotCycles(components)).toEqual([]);
  });

  it('detects a simple 2-cycle', () => {
    const components = [comp('CardA', [['header', ['CardB']]]), comp('CardB', [['footer', ['CardA']]])];
    const cycles = findSlotCycles(components);
    expect(cycles).toHaveLength(1);
    expect(normalizeCyclePath(cycles[0])).toBe('CardA>CardB');
    expect(cycles[0].edges).toHaveLength(2);
    expect(cycles[0].edges.map((e) => e.slotName).sort()).toEqual(['footer', 'header']);
  });

  it('detects a 3-cycle', () => {
    const components = [
      comp('CardA', [['header', ['CardB']]]),
      comp('CardB', [['footer', ['CardC']]]),
      comp('CardC', [['body', ['CardA']]]),
    ];
    const cycles = findSlotCycles(components);
    expect(cycles).toHaveLength(1);
    expect(normalizeCyclePath(cycles[0])).toBe('CardA>CardB>CardC');
  });

  it('detects two independent cycles', () => {
    const components = [
      comp('A', [['s', ['B']]]),
      comp('B', [['s', ['A']]]),
      comp('X', [['s', ['Y']]]),
      comp('Y', [['s', ['X']]]),
    ];
    const cycles = findSlotCycles(components);
    expect(cycles).toHaveLength(2);
    const norms = cycles.map(normalizeCyclePath).sort();
    expect(norms).toEqual(['A>B', 'X>Y']);
  });

  it('detects nested cycles sharing an edge', () => {
    // A→B→C→A (3-cycle) plus B→C→B (2-cycle via a second slot on C)
    const components = [
      comp('A', [['s1', ['B']]]),
      comp('B', [['s1', ['C']]]),
      comp('C', [
        ['s1', ['A']],
        ['s2', ['B']],
      ]),
    ];
    const cycles = findSlotCycles(components);
    const norms = cycles.map(normalizeCyclePath).sort();
    expect(norms).toContain('A>B>C');
    expect(norms).toContain('B>C');
    // Johnson enumerates each elementary cycle exactly once.
    expect(cycles).toHaveLength(2);
  });

  it('detects a self-loop as a degenerate cycle', () => {
    const components = [comp('Self', [['inner', ['Self']]])];
    const cycles = findSlotCycles(components);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].path).toEqual(['Self', 'Self']);
    expect(cycles[0].edges).toEqual([{ fromComponent: 'Self', slotName: 'inner', toComponent: 'Self' }]);
  });

  it('ignores edges to unknown (external) components', () => {
    const components = [
      comp('CardA', [
        ['header', ['External1']],
        ['body', ['CardB']],
      ]),
      comp('CardB', [['footer', ['External2']]]),
    ];
    expect(findSlotCycles(components)).toEqual([]);
  });

  it('handles a large cycle (>8 hops) — truncates only in format, not in detection', () => {
    const names = Array.from({ length: 12 }, (_, i) => `N${i}`);
    const components = names.map((name, i) => comp(name, [['s', [names[(i + 1) % names.length]]]]));
    const cycles = findSlotCycles(components);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].edges).toHaveLength(12);
  });
});

describe('formatCyclePath', () => {
  it('formats a 2-cycle inline', () => {
    const components = [comp('CardA', [['header', ['CardB']]]), comp('CardB', [['footer', ['CardA']]])];
    const [cycle] = findSlotCycles(components);
    // The path starts at whichever node Johnson's found first; regardless,
    // it must be a rotation of A→header→B→footer→A.
    const s = formatCyclePath(cycle);
    expect(s.startsWith('CardA') || s.startsWith('CardB')).toBe(true);
    expect(s.endsWith(s.split(' → ')[0])).toBe(true);
    expect(s).toContain('header');
    expect(s).toContain('footer');
  });

  it('truncates when cycle exceeds maxHops', () => {
    const names = Array.from({ length: 12 }, (_, i) => `N${i}`);
    const components = names.map((name, i) => comp(name, [['s', [names[(i + 1) % names.length]]]]));
    const [cycle] = findSlotCycles(components);
    const s = formatCyclePath(cycle, 8);
    expect(s).toContain('…');
    // Ends with the same node it starts with.
    const first = s.split(' → ')[0];
    expect(s.endsWith(first)).toBe(true);
  });

  it('does not truncate when cycle is exactly maxHops', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const [cycle] = findSlotCycles(components);
    const s = formatCyclePath(cycle, 8);
    expect(s).not.toContain('…');
  });
});

describe('suggestCycleBreakEdge', () => {
  it('picks the edge whose target is the most-referenced hub across all cycles', () => {
    // Two cycles both routing through Hub: A→Hub→A and B→Hub→B.
    const components = [
      comp('A', [['s', ['Hub']]]),
      comp('B', [['s', ['Hub']]]),
      comp('Hub', [
        ['toA', ['A']],
        ['toB', ['B']],
      ]),
    ];
    const cycles = findSlotCycles(components);
    // Every cycle has an edge into Hub — that should be the suggested break.
    for (const cycle of cycles) {
      const edge = suggestCycleBreakEdge(cycle, cycles);
      expect(edge.toComponent).toBe('Hub');
    }
  });

  it('returns a deterministic edge for a simple 2-cycle', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const [cycle] = findSlotCycles(components);
    const edge = suggestCycleBreakEdge(cycle, [cycle]);
    expect(cycle.edges).toContainEqual(edge);
  });
});
