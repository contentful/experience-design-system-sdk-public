/** Sidebar height (rows) — unchanged whether or not the panel is open. */
export const VISIBLE_COUNT = 20;

/** Panel window ceiling (matches LineagePanel's DEFAULT_MAX_ROWS from L2b). */
export const MAX_PANEL_ROWS = 15;

/** Floors — both surfaces stay usable even on a small terminal. */
export const SIDEBAR_MIN = 4;
export const MIN_PANEL_ROWS = 4;

/**
 * Fallback when `stdout.rows` is unavailable (piped output, tests). No TTY
 * means Ink is not interactively repainting, so there is no flicker risk — we
 * assume enough height for the FULL sidebar (BASE_CHROME_OVERHEAD + the full
 * VISIBLE_COUNT) so the non-interactive render is complete and unclipped.
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
 * header bar, the "✓ Extraction complete" + "Found N…" intro, the counter
 * strip (with its blank separator), the cycle banner, the nothing-selected /
 * AI-exclusion hint, the GroupedSidebar box borders + scroll indicator, the
 * focused-detail block, and the wrapping legend region. Measured via the PTY
 * harness against the react-ux-matrix fixture (cycles present = a tall case):
 * the base frame was 39 lines with a 20-row sidebar after the legend row-gap
 * compression, i.e. ≈19 lines of chrome. We use 20 for a one-line safety
 * margin so the total frame stays strictly within `stdout.rows`.
 */
export const BASE_CHROME_OVERHEAD = 20;

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
  /** Rows the LineagePanel should window to (`maxRows`). */
  panelMaxRows: number;
}

/**
 * The sidebar height is constant (the panel replaces it in the same slot, so
 * there is nothing to shrink). When the panel is open its entry window is sized
 * to fit the sidebar's footprint AND the terminal — never taller than the
 * sidebar was, so opening lineage cannot grow the frame past `rows`.
 */
export function computeLineageLayout({ rows, panelOpen, entryCount }: LineageLayoutInput): LineageLayout {
  const sidebarVisible = VISIBLE_COUNT;
  if (!panelOpen) {
    return { sidebarVisible, panelMaxRows: MAX_PANEL_ROWS };
  }
  // Rows available for panel ENTRIES given the terminal and the panel's box
  // chrome; also never taller than the sidebar footprint it replaces.
  const terminalFit = rows - FIXED_OVERHEAD - PANEL_BOX_CHROME;
  let panelBase = Math.min(VISIBLE_COUNT, terminalFit);
  if (entryCount !== undefined && entryCount > 0) {
    panelBase = Math.min(panelBase, entryCount);
  }
  const panelMaxRows = clamp(panelBase, MIN_PANEL_ROWS, MAX_PANEL_ROWS);
  return { sidebarVisible, panelMaxRows };
}

export interface SidebarBudget {
  /** Rows the GroupedSidebar should render (`visibleCount`). */
  sidebarVisibleCount: number;
  /** Rows the LineagePanel should window to (`maxRows`). */
  panelMaxRows: number;
}

/**
 * L2e — autoscale the BASE frame to the terminal height. Even with the lineage
 * panel closed, a fixed 20-row sidebar plus the always-on chrome can exceed a
 * small terminal's rows, so plain Ink (no alt-screen) full-repaints (`\x1b[2J`)
 * on every cursor move = flicker. This sizes the sidebar's visible-row budget
 * from `stdout.rows` minus `BASE_CHROME_OVERHEAD` so the whole frame fits at
 * 24/30/40 rows, and unifies the panel-open sizing with `computeLineageLayout`
 * so BOTH cases stay within the terminal.
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
