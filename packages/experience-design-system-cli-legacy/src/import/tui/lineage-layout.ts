/** Maximum layout rows; the active terminal height determines the actual budget. */
export const VISIBLE_COUNT = 200;

/** Maximum supported panel window; normal terminals remain terminal-sized. */
export const MAX_PANEL_ROWS = 200;

/** Floors — both surfaces stay usable even on a small terminal. */
export const SIDEBAR_MIN = 4;
export const MIN_PANEL_ROWS = 4;

/**
 * Fallback when `stdout.rows` is unavailable (piped output, tests). No TTY
 * means Ink is not interactively repainting, so there is no flicker risk — we
 * assume enough height for a terminal-sized sidebar so the non-interactive
 * render is complete and unclipped.
 */
export const FALLBACK_ROWS = 40;

const HEADER_ROWS = 2;
const COUNTER_STRIP_ROWS = 2;
const FOCUSED_DETAIL_ROWS = 2;
const LEGEND_ROWS = 3;

/**
 * Vertical space consumed by everything ABOVE/BELOW the columns row. The panel
 * shares the columns row, so the fit constraint while open is simply
 * `FIXED_OVERHEAD + panelBoxHeight <= rows`.
 */
export const FIXED_OVERHEAD = HEADER_ROWS + COUNTER_STRIP_ROWS + FOCUSED_DETAIL_ROWS + LEGEND_ROWS;

// Panel box rows that are NOT entry rows: top border + header + footer hint +
// bottom border (+ up to two scroll indicators on large lineages).
export const PANEL_BOX_CHROME = 6;

/**
 * L2e — fixed vertical chrome around the sidebar in the BASE (no-panel) case,
 * counting EVERYTHING that is not a variable sidebar entry row: the wizard
 * header bar, the counter strip (with its blank separator), the cycle banner,
 * the nothing-selected /
 * AI-exclusion hint, the GroupedSidebar box borders + scroll indicator, the
 * focused-detail block, and the wrapping legend region. The value intentionally
 * leaves a small safety margin so resize-induced wrapping does not overflow.
 */
export const BASE_CHROME_OVERHEAD = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface LineageLayoutInput {
  /** Terminal height in rows (`stdout.rows`, or the fallback). */
  rows: number;
  /** Whether the lineage panel is currently open. */
  panelOpen: boolean;
  /** Number of lineage entries — caps the panel window so it never over-allocates. */
  entryCount?: number;
}

export interface LineageLayout {
  /** Rows the sidebar should render (`visibleCount`). Constant across open/closed. */
  sidebarVisible: number;
  /** Rows a sidebar replacement panel should window to (`maxRows`). */
  panelMaxRows: number;
}

/**
 * The sidebar height is constant (the panel replaces it in the same slot, so
 * there is nothing to shrink). Both values are derived from the terminal so
 * resizing grows or shrinks the viewport without content-driven layout changes.
 */
export function computeLineageLayout({ rows, panelOpen, entryCount }: LineageLayoutInput): LineageLayout {
  const sidebarVisible = clamp(rows - BASE_CHROME_OVERHEAD, SIDEBAR_MIN, VISIBLE_COUNT);
  if (!panelOpen) {
    return { sidebarVisible, panelMaxRows: MAX_PANEL_ROWS };
  }
  // Rows available for panel ENTRIES given the terminal and the panel's box
  // chrome; also never taller than the sidebar footprint it replaces.
  const terminalFit = rows - FIXED_OVERHEAD - PANEL_BOX_CHROME;
  let panelBase = Math.min(MAX_PANEL_ROWS, terminalFit);
  if (entryCount !== undefined && entryCount > 0) {
    panelBase = Math.min(panelBase, entryCount);
  }
  const panelMaxRows = clamp(panelBase, MIN_PANEL_ROWS, MAX_PANEL_ROWS);
  return { sidebarVisible, panelMaxRows };
}

export interface SidebarBudget {
  /** Rows the GroupedSidebar should render (`visibleCount`). */
  sidebarVisibleCount: number;
  /** Rows a sidebar replacement panel should window to (`maxRows`). */
  panelMaxRows: number;
}

/**
 * L2e — autoscale the BASE frame to the terminal height. Even with the lineage
 * panel closed, the visible-row budget follows `stdout.rows` minus
 * `BASE_CHROME_OVERHEAD` so the whole frame stays within the terminal while
 * preserving the shared panel-open sizing behavior.
 *
 * Floor: `BASE_CHROME_OVERHEAD + SIDEBAR_MIN`. Below it `SIDEBAR_MIN`
 * (usability) intentionally wins over the fit — a terminal that small can't
 * host the chrome regardless.
 */
export function computeSidebarBudget({ rows, panelOpen, entryCount }: LineageLayoutInput): SidebarBudget {
  const sidebarVisibleCount = clamp(rows - BASE_CHROME_OVERHEAD, SIDEBAR_MIN, VISIBLE_COUNT);
  const { panelMaxRows } = computeLineageLayout({ rows, panelOpen, entryCount });
  return { sidebarVisibleCount, panelMaxRows };
}
