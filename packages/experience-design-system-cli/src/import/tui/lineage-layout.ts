/**
 * L2d — terminal-height-aware sizing for the lineage panel, which now renders
 * AS AN OVERLAY IN THE SIDEBAR SLOT (in place of the GroupedSidebar) rather than
 * stacking below the columns.
 *
 * The flash was measured (PTY harness) to trigger when the total rendered frame
 * height exceeds `stdout.rows`: plain Ink `render()` then emits a full-screen
 * `\x1b[2J` clear on every render, so each lineage cursor move flashes. L2c
 * tried to compensate by SHRINKING the sidebar while stacking the panel below —
 * but the tall fixed chrome still pushed the frame over the terminal height.
 *
 * L2d's fix: the panel takes the sidebar's own vertical footprint. Because it
 * replaces the sidebar (rather than adding rows below the columns), opening the
 * panel does NOT grow the frame — it can never cross the terminal-height
 * threshold that triggers the `2J` clear. Columns 2 & 3 stay visible beside it.
 *
 * So the sidebar no longer needs to shrink. The only sizing job left is to
 * window the panel's entry list so the panel box is about as tall as the
 * sidebar was (never taller) and always fits the terminal.
 */

/** Sidebar height (rows) — unchanged whether or not the panel is open. */
export const VISIBLE_COUNT = 20;

/** Panel window ceiling (matches LineagePanel's DEFAULT_MAX_ROWS from L2b). */
export const MAX_PANEL_ROWS = 15;

/** Floors — both surfaces stay usable even on a small terminal. */
export const SIDEBAR_MIN = 4;
export const MIN_PANEL_ROWS = 4;

/** Conservative fallback when `stdout.rows` is unavailable (classic default). */
export const FALLBACK_ROWS = 24;

// Fixed vertical chrome that frames the columns row: header + counter strip +
// focused-detail block + bottom legend. The panel now lives in the sidebar slot
// (side-by-side with columns 2 & 3), so its own box chrome is NOT added on top
// of this — that is the whole point of L2d.
const HEADER_ROWS = 2; // "✓ Extraction complete" + the "Found N components…" line
const COUNTER_STRIP_ROWS = 2; // marginTop blank + counter content
const FOCUSED_DETAIL_ROWS = 2; // marginTop blank + focused-row name line
const LEGEND_ROWS = 3; // marginTop blank + wrapped key legend

/**
 * Vertical space consumed by everything ABOVE/BELOW the columns row. The panel
 * shares the columns row, so the fit constraint while open is simply
 * `FIXED_OVERHEAD + panelBoxHeight <= rows`.
 */
export const FIXED_OVERHEAD =
  HEADER_ROWS + COUNTER_STRIP_ROWS + FOCUSED_DETAIL_ROWS + LEGEND_ROWS;

// Panel box rows that are NOT entry rows: top border + header + footer hint +
// bottom border (+ up to two scroll indicators on large lineages).
export const PANEL_BOX_CHROME = 6;

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
export function computeLineageLayout({
  rows,
  panelOpen,
  entryCount,
}: LineageLayoutInput): LineageLayout {
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
