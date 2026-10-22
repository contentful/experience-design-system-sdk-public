import type { Closure } from './graph/composite-closure.js';
/** Structural subset of ScopeComponent needed by these helpers. */
export interface ScopeComponentLike {
  name: string;
}

import type { Decision } from './types.js';

const TWO_COLUMN_MIN_WIDTH = 100;
const SCOPE_GATE_MAIN_COLUMN_WIDTH = 54;
const TOKENS_COLUMN_WIDTH = 44;
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

/** The token column needs the width and something to show; without either the gate is the main column alone. */
export function computeColumnWidths(
  totalWidth: number,
  hasTokens: boolean,
  /** The width the token column would like, so no row has to be cut. It gets at most what the terminal has left. */
  wantedTokensWidth = TOKENS_COLUMN_WIDTH,
): {
  layout: 'single' | 'two-column';
  main: number;
  tokens: number;
} {
  if (!hasTokens || totalWidth < TWO_COLUMN_MIN_WIDTH) {
    return { layout: 'single', main: SCOPE_GATE_MAIN_COLUMN_WIDTH, tokens: 0 };
  }
  // Screen padding (2 each side) and the gap between the columns come off what is left.
  const available = totalWidth - 4 - SCOPE_GATE_MAIN_COLUMN_WIDTH - 2;
  const tokens = Math.max(TOKENS_COLUMN_WIDTH, Math.min(wantedTokensWidth, available));
  return { layout: 'two-column', main: SCOPE_GATE_MAIN_COLUMN_WIDTH, tokens };
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
