import { describe, expect, it } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { buildVisibleRows } from '../../../../src/tui/import/steps/07-scope-gate/sidebar/components/GroupedSidebar.js';
import { buildComponentGraph } from '../../../../src/tui/import/steps/07-scope-gate/graph/slot-graph.js';

function entry(allowed: string[]): CDFComponentEntry {
  return {
    $properties: { label: { $type: 'string' } },
    $slots: allowed.length > 0 ? { children: { $allowedComponents: allowed } } : {},
  } as unknown as CDFComponentEntry;
}

function rowsFor(edges: Record<string, string[]>, cycleParticipants = new Set<string>()) {
  const items = Object.entries(edges).map(([key, allowed]) => ({
    key,
    entry: entry(allowed),
    status: 'ok' as const,
  }));
  return buildVisibleRows({
    items,
    cycleParticipants,
    expandedGroups: new Set(),
    alwaysExpanded: true,
    graph: buildComponentGraph(items),
  });
}

describe('buildVisibleRows nesting', () => {
  it('shows only direct children under a root', () => {
    const rows = rowsFor({ A: ['B'], B: ['C'], C: [] });
    const underA = rows.filter((r) => r.rootName === 'A').map((r) => r.label);
    expect(underA.some((l) => l.includes('B'))).toBe(true);
    expect(underA.some((l) => l.includes('C'))).toBe(false);
  });

  it('shows the grandchild under its own parent, so it stays reachable', () => {
    const rows = rowsFor({ A: ['B'], B: ['C'], C: [] });
    const underB = rows.filter((r) => r.rootName === 'B').map((r) => r.label);
    expect(underB.some((l) => l.includes('C'))).toBe(true);
  });

  it('counts only direct children in the root label', () => {
    const rows = rowsFor({ A: ['B'], B: ['C'], C: [] });
    const root = rows.find((r) => r.kind === 'group-root' && r.rootName === 'A');
    expect(root?.label).toContain('(1 dep)');
  });

  it('never indents a child past one level', () => {
    const rows = rowsFor({ A: ['B', 'D'], B: ['C'], D: ['C'], C: [] });
    for (const row of rows.filter((r) => r.kind === 'group-child')) expect(row.indent).toBe(1);
  });

  it('lists direct children of a cycle member once and does not loop', () => {
    const rows = rowsFor({ A: ['B'], B: ['A', 'C'], C: [] }, new Set(['A', 'B']));
    const cycleChildren = rows.filter((r) => r.key.startsWith('cycle-child:A:'));
    expect(cycleChildren.map((r) => r.key)).toEqual(['cycle-child:A:B']);
  });
});
