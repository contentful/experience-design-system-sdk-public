import type { Closure } from '../../analyze/composite-closure.js';
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

export interface AddedComponentEntry {
  name: string;
  isCycle: boolean;
}

export interface AddedGroupEntry {
  name: string;
  depCount: number;
  isCycle: boolean;
}

export function buildAddedComponentsList(
  components: ScopeComponentLike[],
  stateByKey: Map<string, Decision>,
  cycleParticipants: Set<string> = new Set<string>(),
): AddedComponentEntry[] {
  const cycleTier: AddedComponentEntry[] = [];
  const restTier: AddedComponentEntry[] = [];
  for (const c of components) {
    if (stateByKey.get(c.name) !== 'accepted') continue;
    if (cycleParticipants.has(c.name)) cycleTier.push({ name: c.name, isCycle: true });
    else restTier.push({ name: c.name, isCycle: false });
  }
  cycleTier.sort((a, b) => a.name.localeCompare(b.name));
  restTier.sort((a, b) => a.name.localeCompare(b.name));
  return [...cycleTier, ...restTier];
}

export function buildAddedGroupsList(
  closures: Map<string, Closure>,
  stateByKey: Map<string, Decision>,
  cycleParticipants: Set<string> = new Set<string>(),
  cycleUnits: Map<string, Set<string>> = new Map<string, Set<string>>(),
): AddedGroupEntry[] {
  const cycleTier: AddedGroupEntry[] = [];
  const restTier: AddedGroupEntry[] = [];
  const seenNames = new Set<string>();
  for (const [root, closure] of closures.entries()) {
    if (closure.nodes.length <= 1) continue;
    if (stateByKey.get(root) !== 'accepted') continue;
    const entry: AddedGroupEntry = {
      name: root,
      depCount: closure.nodes.length - 1,
      isCycle: cycleParticipants.has(root),
    };
    if (entry.isCycle) cycleTier.push(entry);
    else restTier.push(entry);
    seenNames.add(root);
  }
  // Synthesize one entry per accepted cycle unit. composite-closure collapses
  // cyclic closures to a single-node result (which the filter above drops),
  // so cycle groups would otherwise never appear in the Added-groups panel.
  const seenUnits = new Set<Set<string>>();
  for (const unit of cycleUnits.values()) {
    if (seenUnits.has(unit)) continue;
    seenUnits.add(unit);
    let anyAccepted = false;
    for (const member of unit) {
      if (stateByKey.get(member) === 'accepted') {
        anyAccepted = true;
        break;
      }
    }
    if (!anyAccepted) continue;
    // Alphabetically-first member = Johnson's least-vertex ordering.
    const name = [...unit].sort((a, b) => a.localeCompare(b))[0];
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    cycleTier.push({ name, depCount: unit.size - 1, isCycle: true });
  }
  cycleTier.sort((a, b) => a.name.localeCompare(b.name));
  restTier.sort((a, b) => a.name.localeCompare(b.name));
  return [...cycleTier, ...restTier];
}

export function computeCounters(
  components: ScopeComponentLike[],
  closures: Map<string, Closure>,
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
  let groups = 0;
  for (const [root, closure] of closures.entries()) {
    if (closure.nodes.length <= 1) continue;
    if (stateByKey.get(root) === 'accepted') groups++;
  }
  return { accepted, rejected, undecided, groups, total: components.length };
}
