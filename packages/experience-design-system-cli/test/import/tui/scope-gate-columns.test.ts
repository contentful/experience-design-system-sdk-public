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

  it('returns only accepted names, alphabetical', () => {
    const s = state([
      ['Zed', 'accepted'],
      ['Alpha', 'accepted'],
      ['Mid', 'rejected'],
    ]);
    expect(buildAddedComponentsList(comps, s)).toEqual(['Alpha', 'Zed']);
  });

  it('filters out rejected + undecided', () => {
    const s = state([
      ['Zed', 'undecided'],
      ['Alpha', 'rejected'],
      ['Mid', 'accepted'],
    ]);
    expect(buildAddedComponentsList(comps, s)).toEqual(['Mid']);
  });

  it('returns empty when nothing is accepted', () => {
    const s = state([
      ['Zed', 'rejected'],
      ['Alpha', 'rejected'],
      ['Mid', 'rejected'],
    ]);
    expect(buildAddedComponentsList(comps, s)).toEqual([]);
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
    const groups = buildAddedGroupsList(computeAllClosures(graph), s);
    expect(groups).toEqual([{ name: 'Card', depCount: 2 }]);
  });

  it('excludes roots that are rejected', () => {
    const s = state([
      ['Card', 'rejected'],
      ['Text', 'accepted'],
      ['Icon', 'accepted'],
    ]);
    expect(buildAddedGroupsList(computeAllClosures(graph), s)).toEqual([]);
  });

  it('excludes standalones (closure of 1 node)', () => {
    const s = state([['Standalone', 'accepted']]);
    expect(buildAddedGroupsList(computeAllClosures(graph), s)).toEqual([]);
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
