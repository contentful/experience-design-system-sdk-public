import { describe, expect, it } from 'vitest';
import {
  buildAddedComponentsList,
  ACCEPTED_COMPONENTS_COLUMN_WIDTH,
  SCOPE_GATE_MAIN_COLUMN_WIDTH,
  computeColumnWidths,
  computePanelLayout,
  computeCounters,
  type Decision,
} from '../../../src/import/tui/scope-gate-columns.js';
import type { ComponentGraphNode } from '../../../src/analyze/composite-closure.js';
import { computeAllClosures } from '../../../src/analyze/composite-closure.js';

const state = (entries: Array<[string, Decision]>): Map<string, Decision> => new Map(entries);

describe('computeColumnWidths', () => {
  it('collapses to single-column below the wide-terminal threshold', () => {
    const plan = computeColumnWidths(80);
    expect(plan.layout).toBe('single');
    expect(plan.main).toBe(SCOPE_GATE_MAIN_COLUMN_WIDTH);
    expect(plan.added).toBe(0);
  });

  it('produces a main list and accepted-components column at wide terminals', () => {
    const plan = computeColumnWidths(100);
    expect(plan.layout).toBe('two-column');
    expect(plan.main).toBe(SCOPE_GATE_MAIN_COLUMN_WIDTH);
    expect(plan.added).toBe(ACCEPTED_COMPONENTS_COLUMN_WIDTH);
  });

  it('keeps the accepted-components column fixed at wide terminals', () => {
    const plan = computeColumnWidths(200);
    expect(plan.layout).toBe('two-column');
    expect(plan.main).toBe(SCOPE_GATE_MAIN_COLUMN_WIDTH);
    expect(plan.added).toBe(ACCEPTED_COMPONENTS_COLUMN_WIDTH);
  });
});

describe('computePanelLayout', () => {
  it('keeps header and headerless panels in the same outer frame', () => {
    const layout = computePanelLayout(20);

    expect(layout.height).toBe(26);
    expect(layout.mainVisibleCount).toBe(20);
    expect(layout.sideVisibleCount).toBe(20);
  });

  it('never lets a content budget resize the shared frame below one row', () => {
    expect(computePanelLayout(0)).toEqual({ height: 7, mainVisibleCount: 1, sideVisibleCount: 1 });
  });
});

describe('buildAddedComponentsList', () => {
  it('returns only accepted entries, alphabetically, with cycles first', () => {
    const components = [{ name: 'Zed' }, { name: 'Alpha' }, { name: 'Mid' }];
    expect(
      buildAddedComponentsList(
        components,
        state([
          ['Zed', 'accepted'],
          ['Alpha', 'accepted'],
          ['Mid', 'rejected'],
        ]),
        new Set(['Zed']),
      ),
    ).toEqual([
      { name: 'Zed', isCycle: true },
      { name: 'Alpha', isCycle: false },
    ]);
  });

  it('deduplicates accepted components with the same name', () => {
    const components = [{ name: 'Navigation' }, { name: 'Navigation' }, { name: 'Logo' }];
    expect(
      buildAddedComponentsList(
        components,
        state([
          ['Navigation', 'accepted'],
          ['Logo', 'accepted'],
        ]),
      ),
    ).toEqual([
      { name: 'Logo', isCycle: false },
      { name: 'Navigation', isCycle: false },
    ]);
  });
});

describe('computeCounters', () => {
  const graph: ComponentGraphNode[] = [
    { name: 'Card', slots: [{ name: 'body', allowedComponents: ['Text'] }] },
    { name: 'Text', slots: [] },
    { name: 'Standalone', slots: [] },
  ];

  it('counts accepted, rejected, undecided, and composite groups', () => {
    expect(
      computeCounters(
        graph,
        computeAllClosures(graph),
        state([
          ['Card', 'accepted'],
          ['Text', 'rejected'],
          ['Standalone', 'undecided'],
        ]),
      ),
    ).toEqual({ accepted: 1, rejected: 1, undecided: 1, groups: 1, total: 3 });
  });
});
