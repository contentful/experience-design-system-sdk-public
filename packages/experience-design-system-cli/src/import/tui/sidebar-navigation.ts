import type { ComponentGraphNode, Closure } from '../../analyze/composite-closure.js';
import { buildVisibleRows, type GroupedSidebarItem } from '../../analyze/select/tui/components/GroupedSidebar.js';

export function collectExpandedGroupRoots(
  closures: Map<string, Closure>,
  cycleParticipants: Iterable<string>,
): Set<string> {
  const roots = new Set<string>();
  for (const [name, closure] of closures.entries()) {
    if (closure.nodes.length > 1) roots.add(name);
  }
  for (const name of cycleParticipants) roots.add(name);
  return roots;
}

export function computeSidebarViewToggle({
  currentView,
  currentKey,
  currentScroll,
  visibleCount,
  items,
  cycleParticipants,
  expandedGroups,
  graph,
  showFlatTier = false,
}: {
  currentView: 'grouped' | 'flat';
  currentKey: string | null | undefined;
  currentScroll: number;
  visibleCount: number;
  items: GroupedSidebarItem[];
  cycleParticipants: Set<string>;
  expandedGroups: Set<string>;
  graph: ComponentGraphNode[];
  showFlatTier?: boolean;
}): { view: 'grouped' | 'flat'; cursor: number; scroll: number } {
  const view = currentView === 'grouped' ? 'flat' : 'grouped';
  const rows = buildVisibleRows({
    items,
    cycleParticipants,
    expandedGroups,
    showFlatTier,
    viewMode: view,
    graph,
  });
  let cursor = 0;
  if (currentKey) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.itemIdx < 0) continue;
      if (items[row.itemIdx]?.key === currentKey) {
        cursor = i;
        break;
      }
    }
  }
  const scroll =
    cursor < currentScroll
      ? cursor
      : cursor >= currentScroll + visibleCount
        ? cursor - visibleCount + 1
        : currentScroll;
  return { view, cursor, scroll };
}
