import { PALETTE } from './sidebar/theme.js';
import type { Closure } from './graph/composite-closure.js';
/** Structural subset of ScopeComponent needed by these helpers. */
export interface ScopeComponentLike {
  name: string;
}

import type { Decision } from './types.js';

const TWO_COLUMN_MIN_WIDTH = 100;
export const SCOPE_GATE_MAIN_COLUMN_WIDTH = 54;
export const ACCEPTED_COMPONENTS_COLUMN_WIDTH = 36;
const PANEL_BORDER_ROWS = 2;
const PANEL_INDICATOR_ROWS = 2;
const PANEL_HEADER_ROWS = 2;

export interface ScopeGatePanelLayout {
  height: number;
  mainVisibleCount: number;
  sideVisibleCount: number;
}

/**
 * All scope-gate panels share one terminal-sized frame. Panels with a header
 * therefore receive the same content rows because every scope-gate panel has
 * the same header and indicator chrome.
 */
export function computePanelLayout(mainVisibleCount: number): ScopeGatePanelLayout {
  const safeMainVisibleCount = Math.max(1, mainVisibleCount);
  const height = safeMainVisibleCount + PANEL_BORDER_ROWS + PANEL_INDICATOR_ROWS + PANEL_HEADER_ROWS;
  const sideVisibleCount = Math.max(1, height - PANEL_BORDER_ROWS - PANEL_INDICATOR_ROWS - PANEL_HEADER_ROWS);
  return { height, mainVisibleCount: safeMainVisibleCount, sideVisibleCount };
}

export function computeColumnWidths(totalWidth: number): {
  layout: 'single' | 'two-column';
  main: number;
  added: number;
} {
  if (totalWidth < TWO_COLUMN_MIN_WIDTH) {
    return { layout: 'single', main: SCOPE_GATE_MAIN_COLUMN_WIDTH, added: 0 };
  }
  const main = SCOPE_GATE_MAIN_COLUMN_WIDTH;
  const added = ACCEPTED_COMPONENTS_COLUMN_WIDTH;
  return { layout: 'two-column', main, added };
}

export interface AddedComponentEntry {
  name: string;
  isCycle: boolean;
}

function sortTieredEntries<T extends { name: string }>(cycleTier: T[], restTier: T[]): T[] {
  cycleTier.sort((a, b) => a.name.localeCompare(b.name));
  restTier.sort((a, b) => a.name.localeCompare(b.name));
  return [...cycleTier, ...restTier];
}

export function buildAddedComponentsList(
  components: ScopeComponentLike[],
  stateByKey: Map<string, Decision>,
  cycleParticipants: Set<string> = new Set<string>(),
): AddedComponentEntry[] {
  const cycleTier: AddedComponentEntry[] = [];
  const restTier: AddedComponentEntry[] = [];
  // Selection state is keyed by name, so components sharing a name (real
  // collisions across files) collapse to one accepted entry — dedupe by name
  // to avoid duplicate rows and non-unique React keys downstream.
  const seen = new Set<string>();
  for (const c of components) {
    if (stateByKey.get(c.name) !== 'accepted') continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    if (cycleParticipants.has(c.name)) cycleTier.push({ name: c.name, isCycle: true });
    else restTier.push({ name: c.name, isCycle: false });
  }
  return sortTieredEntries(cycleTier, restTier);
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

export function sideColumnLabelStyle(input: { isCycle: boolean; isSelected: boolean; focused: boolean }): {
  nameColor: string | undefined;
  nameBold: boolean;
  nameInverse: boolean;
  nameUnderline: boolean;
  suffixColor: string | undefined;
  suffixDim: boolean;
  suffixInverse: boolean;
  suffixUnderline: boolean;
} {
  const { isCycle, isSelected, focused } = input;
  const isCursor = isSelected && focused;
  if (isCursor) {
    return {
      nameColor: PALETTE.info,
      nameBold: true,
      nameInverse: false,
      nameUnderline: false,
      suffixColor: PALETTE.info,
      suffixDim: false,
      suffixInverse: false,
      suffixUnderline: false,
    };
  }
  const underline = isSelected && !focused;
  if (isCycle) {
    return {
      nameColor: PALETTE.warning,
      nameBold: false,
      nameInverse: false,
      nameUnderline: underline,
      suffixColor: PALETTE.warning,
      suffixDim: false,
      suffixInverse: false,
      suffixUnderline: underline,
    };
  }
  return {
    nameColor: PALETTE.success,
    nameBold: false,
    nameInverse: false,
    nameUnderline: underline,
    suffixColor: PALETTE.info,
    suffixDim: true,
    suffixInverse: false,
    suffixUnderline: underline,
  };
}

export function computeColumnWindow(
  total: number,
  cursor: number,
  visibleCount: number,
): { start: number; end: number; above: number; below: number } {
  if (total <= visibleCount) return { start: 0, end: total, above: 0, below: 0 };
  let start = Math.max(0, cursor - Math.floor(visibleCount / 2));
  start = Math.min(start, total - visibleCount);
  const end = start + visibleCount;
  return { start, end, above: start, below: total - end };
}
