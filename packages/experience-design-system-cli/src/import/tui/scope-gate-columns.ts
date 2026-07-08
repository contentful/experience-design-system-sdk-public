import type { ComponentGraphNode } from '../../analyze/composite-closure.js';
import { computeAllClosures } from '../../analyze/composite-closure.js';
import { computeSidebarWidth } from './sidebar-width.js';
/** Structural subset of ScopeComponent needed by these helpers. */
export interface ScopeComponentLike {
  name: string;
}

export type Decision = 'accepted' | 'rejected' | 'undecided';

/**
 * Multi-column layout threshold. Below this the scope-gate collapses to a
 * single sidebar column + counter strip. Chosen so 3-col layout doesn't
 * overflow on a standard 120-col terminal.
 */
export const THREE_COLUMN_MIN_WIDTH = 120;

/**
 * Column-width plan for the scope-gate step. When the terminal is narrower
 * than THREE_COLUMN_MIN_WIDTH, only the main sidebar renders; `added` and
 * `groups` widths are 0.
 */
export function computeColumnWidths(totalWidth: number): {
  layout: 'single' | 'three-column';
  main: number;
  added: number;
  groups: number;
} {
  if (totalWidth < THREE_COLUMN_MIN_WIDTH) {
    return { layout: 'single', main: computeSidebarWidth(totalWidth), added: 0, groups: 0 };
  }
  const main = computeSidebarWidth(totalWidth);
  // 4 chars of inter-column padding total.
  const remaining = Math.max(0, totalWidth - main - 4);
  const added = Math.floor(remaining * 0.45);
  const groups = Math.max(0, remaining - added - 2);
  return { layout: 'three-column', main, added, groups };
}

export function buildAddedComponentsList(
  components: ScopeComponentLike[],
  stateByKey: Map<string, Decision>,
): string[] {
  return components
    .filter((c) => stateByKey.get(c.name) === 'accepted')
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b));
}

export function buildAddedGroupsList(
  graph: ComponentGraphNode[],
  stateByKey: Map<string, Decision>,
): Array<{ name: string; depCount: number }> {
  const closures = computeAllClosures(graph);
  const out: Array<{ name: string; depCount: number }> = [];
  for (const [root, closure] of closures.entries()) {
    if (closure.nodes.length <= 1) continue;
    if (stateByKey.get(root) !== 'accepted') continue;
    out.push({ name: root, depCount: closure.nodes.length - 1 });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function computeCounters(
  components: ScopeComponentLike[],
  graph: ComponentGraphNode[],
  stateByKey: Map<string, Decision>,
): { accepted: number; rejected: number; undecided: number; groups: number; total: number } {
  let accepted = 0;
  let rejected = 0;
  let undecided = 0;
  for (const c of components) {
    const s = stateByKey.get(c.name) ?? 'undecided';
    if (s === 'accepted') accepted++;
    else if (s === 'rejected') rejected++;
    else undecided++;
  }
  const closures = computeAllClosures(graph);
  let groups = 0;
  for (const [root, closure] of closures.entries()) {
    if (closure.nodes.length <= 1) continue;
    if (stateByKey.get(root) === 'accepted') groups++;
  }
  return { accepted, rejected, undecided, groups, total: components.length };
}
