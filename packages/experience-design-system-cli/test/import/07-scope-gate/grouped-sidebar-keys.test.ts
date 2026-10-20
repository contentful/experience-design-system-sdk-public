import { describe, expect, it } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  buildVisibleRows,
  type GroupedSidebarItem,
} from '../../../src/tui/import/steps/07-scope-gate/sidebar/components/GroupedSidebar.js';
import type { ComponentGraphNode } from '../../../src/tui/import/steps/07-scope-gate/graph/composite-closure.js';

function item(name: string, allowedComponents: string[] = []): GroupedSidebarItem {
  const $slots = allowedComponents.length > 0 ? { children: { $allowedComponents: allowedComponents } } : {};
  return {
    key: name,
    status: 'ok',
    entry: { $type: 'component', $properties: {}, $slots } as CDFComponentEntry,
  };
}

function graph(items: GroupedSidebarItem[]): ComponentGraphNode[] {
  return items.map((entry) => ({
    name: entry.key,
    slots: Object.entries(entry.entry.$slots ?? {}).map(([name, slot]) => ({
      name,
      allowedComponents: slot.$allowedComponents as string[] | undefined,
    })),
  }));
}

function visible(
  items: GroupedSidebarItem[],
  cycleParticipants: Set<string>,
  expandedGroups: Set<string>,
  filterVisibleKeys?: Set<string>,
) {
  return buildVisibleRows({
    items,
    cycleParticipants,
    expandedGroups,
    graph: graph(items),
    filterVisibleKeys,
  });
}

describe('grouped sidebar occurrence keys', () => {
  it('distinguishes repeated cycle-member occurrences under separate parents and same-edge entries', () => {
    const items = [
      item('Root', ['Parent A', 'Parent B']),
      item('Parent A', ['Cycle', 'Cycle']),
      item('Parent B', ['Cycle']),
      item('Cycle'),
    ];
    const cycleParticipants = new Set(['Cycle']);
    const expanded = visible(items, cycleParticipants, new Set(['Root'])).filter(
      (row) => row.rootName === 'Root' && row.cycleChild,
    );

    expect(expanded).toHaveLength(3);
    expect(expanded.map((row) => items[row.itemIdx]?.key)).toEqual(['Cycle', 'Cycle', 'Cycle']);
    expect(new Set(expanded.map((row) => row.key)).size).toBe(3);

    const filtered = visible(items, cycleParticipants, new Set(['Root']), new Set(['Cycle'])).filter(
      (row) => row.rootName === 'Root' && row.cycleChild,
    );
    expect(filtered.map((row) => row.key)).toEqual(expanded.map((row) => row.key));
    expect(visible(items, cycleParticipants, new Set()).some((row) => row.rootName === 'Root' && row.cycleChild)).toBe(
      false,
    );
    expect(
      visible(items, cycleParticipants, new Set(['Root']))
        .filter((row) => row.rootName === 'Root' && row.cycleChild)
        .map((row) => row.key),
    ).toEqual(expanded.map((row) => row.key));
  });

  it('does not let delimiter-bearing root and component names collide', () => {
    const items = [item('Root:Alpha', ['Leaf']), item('Root', ['Alpha:Leaf']), item('Leaf'), item('Alpha:Leaf')];
    const rows = visible(items, new Set(['Leaf', 'Alpha:Leaf']), new Set(['Root:Alpha', 'Root'])).filter(
      (row) => row.cycleChild,
    );

    expect(rows.map((row) => [row.rootName, items[row.itemIdx]?.key])).toEqual([
      ['Root', 'Alpha:Leaf'],
      ['Root:Alpha', 'Leaf'],
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});
