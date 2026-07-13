import { describe, expect, it } from 'vitest';
import {
  buildAddedComponentsList,
  buildAddedGroupsList,
  computeColumnWidths,
  computeCounters,
  type Decision,
} from '../../../src/import/tui/scope-gate-columns.js';
import type { ComponentGraphNode } from '../../../src/analyze/composite-closure.js';
import { computeAllClosures } from '../../../src/analyze/composite-closure.js';

const state = (
  entries: Array<[string, Decision]>,
): Map<string, Decision> => new Map(entries);

describe('computeColumnWidths', () => {
  it('collapses to single-column at 80 cols', () => {
    const plan = computeColumnWidths(80);
    expect(plan.layout).toBe('single');
    expect(plan.main).toBe(36);
    expect(plan.added).toBe(0);
    expect(plan.groups).toBe(0);
  });

  it('produces three columns at 120 cols with widths that sum within total', () => {
    const plan = computeColumnWidths(120);
    expect(plan.layout).toBe('three-column');
    expect(plan.main).toBe(54);
    // main + 4 padding + added + groups + 2 padding = 120
    expect(plan.main + 4 + plan.added + plan.groups + 2).toBeLessThanOrEqual(120);
    expect(plan.added).toBeGreaterThan(0);
    expect(plan.groups).toBeGreaterThan(0);
  });

  it('produces three columns at 200 cols and stays within total', () => {
    const plan = computeColumnWidths(200);
    expect(plan.layout).toBe('three-column');
    expect(plan.main).toBe(60);
    expect(plan.main + 4 + plan.added + plan.groups + 2).toBeLessThanOrEqual(200);
    expect(plan.added).toBeGreaterThan(0);
    expect(plan.groups).toBeGreaterThan(0);
  });

  it('boundary: 119 cols falls back to single-column', () => {
    const plan = computeColumnWidths(119);
    expect(plan.layout).toBe('single');
  });
});

describe('buildAddedComponentsList', () => {
  const comps = [
    { name: 'Zed' },
    { name: 'Alpha' },
    { name: 'Mid' },
  ];

  it('returns only accepted entries, alphabetical', () => {
    const s = state([
      ['Zed', 'accepted'],
      ['Alpha', 'accepted'],
      ['Mid', 'rejected'],
    ]);
    expect(buildAddedComponentsList(comps, s, new Set<string>())).toEqual([
      { name: 'Alpha', isCycle: false },
      { name: 'Zed', isCycle: false },
    ]);
  });

  it('filters out rejected + undecided', () => {
    const s = state([
      ['Zed', 'undecided'],
      ['Alpha', 'rejected'],
      ['Mid', 'accepted'],
    ]);
    expect(buildAddedComponentsList(comps, s, new Set<string>())).toEqual([
      { name: 'Mid', isCycle: false },
    ]);
  });

  it('returns empty when nothing is accepted', () => {
    const s = state([
      ['Zed', 'rejected'],
      ['Alpha', 'rejected'],
      ['Mid', 'rejected'],
    ]);
    expect(buildAddedComponentsList(comps, s, new Set<string>())).toEqual([]);
  });

  it('places accepted cycle-participants at the top with isCycle:true', () => {
    const s = state([
      ['Zed', 'accepted'],
      ['Alpha', 'accepted'],
      ['Mid', 'accepted'],
    ]);
    const cycles = new Set(['Zed']);
    expect(buildAddedComponentsList(comps, s, cycles)).toEqual([
      { name: 'Zed', isCycle: true },
      { name: 'Alpha', isCycle: false },
      { name: 'Mid', isCycle: false },
    ]);
  });

  it('sorts within each tier alphabetically', () => {
    const wider = [{ name: 'B' }, { name: 'A' }, { name: 'D' }, { name: 'C' }];
    const s = state([
      ['A', 'accepted'],
      ['B', 'accepted'],
      ['C', 'accepted'],
      ['D', 'accepted'],
    ]);
    const cycles = new Set(['D', 'B']);
    expect(buildAddedComponentsList(wider, s, cycles)).toEqual([
      { name: 'B', isCycle: true },
      { name: 'D', isCycle: true },
      { name: 'A', isCycle: false },
      { name: 'C', isCycle: false },
    ]);
  });

  it('excludes cycle-participants that are not accepted', () => {
    const s = state([
      ['Zed', 'rejected'],
      ['Alpha', 'accepted'],
      ['Mid', 'accepted'],
    ]);
    const cycles = new Set(['Zed']);
    expect(buildAddedComponentsList(comps, s, cycles)).toEqual([
      { name: 'Alpha', isCycle: false },
      { name: 'Mid', isCycle: false },
    ]);
  });
});

const graph: ComponentGraphNode[] = [
  { name: 'Card', slots: [{ name: 'body', allowedComponents: ['Text', 'Icon'] }] },
  { name: 'Text', slots: [] },
  { name: 'Icon', slots: [] },
  { name: 'Standalone', slots: [] },
];

describe('buildAddedGroupsList', () => {
  it('lists composite roots whose state is accepted, with dep counts', () => {
    const s = state([
      ['Card', 'accepted'],
      ['Text', 'accepted'],
      ['Icon', 'accepted'],
      ['Standalone', 'accepted'],
    ]);
    const groups = buildAddedGroupsList(computeAllClosures(graph), s, new Set<string>());
    expect(groups).toEqual([{ name: 'Card', depCount: 2, isCycle: false }]);
  });

  it('excludes roots that are rejected', () => {
    const s = state([
      ['Card', 'rejected'],
      ['Text', 'accepted'],
      ['Icon', 'accepted'],
    ]);
    expect(buildAddedGroupsList(computeAllClosures(graph), s, new Set<string>())).toEqual([]);
  });

  it('excludes standalones (closure of 1 node)', () => {
    const s = state([['Standalone', 'accepted']]);
    expect(buildAddedGroupsList(computeAllClosures(graph), s, new Set<string>())).toEqual([]);
  });

  it('emits one entry per accepted member of a 2-cycle (mirrors sidebar roots)', () => {
    // A↔B cycle: composite-closure short-circuits to nodes.length=1, so no
    // closure entry survives the filter. buildAddedGroupsList must synthesize
    // ONE entry PER accepted member of each cycle unit — mirroring how the
    // sidebar renders one cycle-root row per member — with depCount = size - 1
    // and isCycle: true.
    const closures = new Map();
    const s = state([
      ['B', 'accepted'],
      ['A', 'accepted'],
    ]);
    const cycleParticipants = new Set(['A', 'B']);
    const unit = new Set(['A', 'B']);
    const cycleUnits = new Map<string, Set<string>>([
      ['A', unit],
      ['B', unit],
    ]);
    const out = buildAddedGroupsList(closures, s, cycleParticipants, cycleUnits);
    expect(out).toEqual([
      { name: 'A', depCount: 1, isCycle: true },
      { name: 'B', depCount: 1, isCycle: true },
    ]);
  });

  it('emits only the accepted members of a cycle unit', () => {
    // unit {A, B}, only A accepted → only A appears.
    const closures = new Map();
    const s = state([
      ['A', 'accepted'],
      ['B', 'rejected'],
    ]);
    const cycleParticipants = new Set(['A', 'B']);
    const unit = new Set(['A', 'B']);
    const cycleUnits = new Map<string, Set<string>>([
      ['A', unit],
      ['B', unit],
    ]);
    const out = buildAddedGroupsList(closures, s, cycleParticipants, cycleUnits);
    expect(out).toEqual([{ name: 'A', depCount: 1, isCycle: true }]);
  });

  it('emits all three members of a 3-cycle when all accepted', () => {
    const closures = new Map();
    const s = state([
      ['NodeA', 'accepted'],
      ['NodeB', 'accepted'],
      ['NodeC', 'accepted'],
    ]);
    const cycleParticipants = new Set(['NodeA', 'NodeB', 'NodeC']);
    const unit = new Set(['NodeA', 'NodeB', 'NodeC']);
    const cycleUnits = new Map<string, Set<string>>([
      ['NodeA', unit],
      ['NodeB', unit],
      ['NodeC', unit],
    ]);
    const out = buildAddedGroupsList(closures, s, cycleParticipants, cycleUnits);
    expect(out).toEqual([
      { name: 'NodeA', depCount: 2, isCycle: true },
      { name: 'NodeB', depCount: 2, isCycle: true },
      { name: 'NodeC', depCount: 2, isCycle: true },
    ]);
  });

  it('does not double-emit a member that is also a real non-trivial closure root', () => {
    // 'A' is both a cycle-unit member AND a surviving closure root (nodes>1).
    // The real-closure pass emits it once; the cycle synthesis must dedup on
    // member name and skip it — no duplicate entry.
    const closures = new Map(
      Object.entries({
        A: {
          root: 'A',
          nodes: [
            { name: 'A', depth: 0, path: ['A'], parents: [] },
            { name: 'Leaf', depth: 1, path: ['A', 'Leaf'], parents: ['A'] },
          ],
          containsCycle: false,
        },
      }),
    );
    const s = state([
      ['A', 'accepted'],
      ['B', 'accepted'],
    ]);
    const cycleParticipants = new Set(['A', 'B']);
    const unit = new Set(['A', 'B']);
    const cycleUnits = new Map<string, Set<string>>([
      ['A', unit],
      ['B', unit],
    ]);
    const out = buildAddedGroupsList(closures, s, cycleParticipants, cycleUnits);
    // A appears once (from the closure pass, depCount 1 from its 2-node
    // closure); B appears once from cycle synthesis.
    const names = out.map((e) => e.name).sort();
    expect(names).toEqual(['A', 'B']);
    expect(out.filter((e) => e.name === 'A')).toHaveLength(1);
  });

  it('does not synthesize a cycle-group entry when no member is accepted', () => {
    const closures = new Map();
    const s = state([
      ['A', 'rejected'],
      ['B', 'undecided'],
    ]);
    const cycleParticipants = new Set(['A', 'B']);
    const unit = new Set(['A', 'B']);
    const cycleUnits = new Map<string, Set<string>>([
      ['A', unit],
      ['B', unit],
    ]);
    expect(buildAddedGroupsList(closures, s, cycleParticipants, cycleUnits)).toEqual([]);
  });

  it('preserves non-cycle groups alongside synthesized cycle-group entries', () => {
    const s = state([
      ['Card', 'accepted'],
      ['Text', 'accepted'],
      ['Icon', 'accepted'],
      ['A', 'accepted'],
      ['B', 'accepted'],
    ]);
    const cycleParticipants = new Set(['A', 'B']);
    const unit = new Set(['A', 'B']);
    const cycleUnits = new Map<string, Set<string>>([
      ['A', unit],
      ['B', unit],
    ]);
    const out = buildAddedGroupsList(computeAllClosures(graph), s, cycleParticipants, cycleUnits);
    expect(out).toEqual([
      { name: 'A', depCount: 1, isCycle: true },
      { name: 'B', depCount: 1, isCycle: true },
      { name: 'Card', depCount: 2, isCycle: false },
    ]);
  });

  it('tags composite roots as isCycle:true when they appear in cycleParticipants', () => {
    // Build the closure map synthetically. The composite-closure module cannot
    // organically produce a cyclic composite root (findRoots excludes cycle
    // participants; computeClosure collapses cyclic closures to nodes.length=1
    // which buildAddedGroupsList then filters out). Cycle-tagging on Column 3
    // is a rendering convention: when a root that survives the closure filter
    // is also known to be a cycle participant, its entry must be flagged.
    const synthetic = new Map(
      Object.entries({
        Card: {
          root: 'Card',
          nodes: [
            { name: 'Card', depth: 0, path: ['Card'], parents: [] },
            { name: 'Text', depth: 1, path: ['Card', 'Text'], parents: ['Card'] },
          ],
          containsCycle: false,
        },
        Loopy: {
          root: 'Loopy',
          nodes: [
            { name: 'Loopy', depth: 0, path: ['Loopy'], parents: [] },
            { name: 'Widget', depth: 1, path: ['Loopy', 'Widget'], parents: ['Loopy'] },
          ],
          containsCycle: false,
        },
      }),
    );
    const s = state([
      ['Card', 'accepted'],
      ['Loopy', 'accepted'],
    ]);
    const cycles = new Set(['Loopy']);
    const out = buildAddedGroupsList(synthetic, s, cycles);
    expect(out).toEqual([
      { name: 'Loopy', depCount: 1, isCycle: true },
      { name: 'Card', depCount: 1, isCycle: false },
    ]);
  });
});

describe('computeCounters', () => {
  it('counts accepted/rejected/undecided across all components', () => {
    const comps = [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }];
    const g: ComponentGraphNode[] = comps.map((c) => ({ name: c.name, slots: [] }));
    const s = state([
      ['A', 'accepted'],
      ['B', 'rejected'],
      ['C', 'undecided'],
      ['D', 'accepted'],
    ]);
    expect(computeCounters(comps, computeAllClosures(g), s)).toEqual({
      accepted: 2,
      rejected: 1,
      undecided: 1,
      groups: 0,
      total: 4,
    });
  });

  it('counts accepted composite roots as groups', () => {
    const s = state([
      ['Card', 'accepted'],
      ['Text', 'accepted'],
      ['Icon', 'accepted'],
      ['Standalone', 'accepted'],
    ]);
    const c = computeCounters(
      [{ name: 'Card' }, { name: 'Text' }, { name: 'Icon' }, { name: 'Standalone' }],
      computeAllClosures(graph),
      s,
    );
    expect(c.groups).toBe(1);
    expect(c.accepted).toBe(4);
  });
});
