import type { Closure } from '../../analyze/composite-closure.js';
import { computeSidebarWidth } from './sidebar-width.js';
/** Structural subset of ScopeComponent needed by these helpers. */
export interface ScopeComponentLike {
  name: string;
}

export type Decision = 'accepted' | 'rejected' | 'undecided';

export const THREE_COLUMN_MIN_WIDTH = 120;

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
  const seenUnits = new Set<Set<string>>();
  for (const unit of cycleUnits.values()) {
    if (seenUnits.has(unit)) continue;
    seenUnits.add(unit);
    for (const member of unit) {
      if (stateByKey.get(member) !== 'accepted') continue;
      if (seenNames.has(member)) continue;
      seenNames.add(member);
      cycleTier.push({ name: member, depCount: unit.size - 1, isCycle: true });
    }
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
