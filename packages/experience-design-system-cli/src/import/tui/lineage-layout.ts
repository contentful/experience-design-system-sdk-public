/**
 * L2c — terminal-height-aware layout for the lineage panel.
 *
 * L2b windowed the LineagePanel itself, but the flash on large lineages
 * persisted: the flash is driven by TOTAL rendered frame height, not the
 * panel's own height. With the sidebar rendering a fixed 20 rows plus the
 * header, counter strip, focused-detail block, panel chrome, and bottom
 * legend, the total stack exceeds a normal terminal. When Ink's output is
 * taller than `stdout.rows` it cannot do a differential repaint and instead
 * clears + repaints the whole screen on every render — each lineage cursor
 * move is a render, so the operator sees a flash.
 *
 * The fix: when the lineage panel is OPEN, shrink the sidebar's visible rows
 * and size the panel's `maxRows` from the remaining budget so the whole
 * frame fits `stdout.rows`. Columns get shorter while inspecting lineage;
 * that is the accepted tradeoff. When the panel is CLOSED the sidebar uses
 * its full height (no regression).
 */

/** Full sidebar height when the lineage panel is closed. */
export const VISIBLE_COUNT = 20;

/** Panel window default (matches LineagePanel's DEFAULT_MAX_ROWS from L2b). */
export const MAX_PANEL_ROWS = 15;

/** Floors — both surfaces stay usable even on a small terminal. */
export const SIDEBAR_MIN = 4;
export const MIN_PANEL_ROWS = 4;

/** Conservative fallback when `stdout.rows` is unavailable (classic default). */
export const FALLBACK_ROWS = 24;

// Fixed vertical chrome that frames the sidebar + panel entries. Estimated
// conservatively so the computed budget errs toward fitting: over-counting
// only shrinks the surfaces, which never re-introduces the overflow flash.
const HEADER_ROWS = 2; // "✓ Extraction complete" + the "Found N components…" line
const COUNTER_STRIP_ROWS = 2; // marginTop blank + counter content
const FOCUSED_DETAIL_ROWS = 2; // marginTop blank + focused-row name line
const LEGEND_ROWS = 3; // marginTop blank + wrapped key legend
// Panel's own non-entry rows: marginTop blank + top border + header +
// footer hint + bottom border + both scroll indicators (worst case).
const PANEL_CHROME_ROWS = 7;

/**
 * Total vertical space consumed by everything that is NOT a sidebar entry row
 * or a panel entry row. The layout invariant that must hold while the panel is
 * open: `FIXED_OVERHEAD + sidebarVisible + panelMaxRows <= rows`.
 */
export const FIXED_OVERHEAD =
  HEADER_ROWS +
  COUNTER_STRIP_ROWS +
  FOCUSED_DETAIL_ROWS +
  LEGEND_ROWS +
  PANEL_CHROME_ROWS;

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
  /** Rows the sidebar should render (`visibleCount`). */
  sidebarVisible: number;
  /** Rows the LineagePanel should window to (`maxRows`). */
  panelMaxRows: number;
}

/**
 * Height-aware split. Closed → full sidebar + default panel window. Open →
 * split the budget (`rows - FIXED_OVERHEAD`) between the sidebar and the panel,
 * giving the panel up to half and the sidebar the rest, each clamped to its
 * min/max. On large terminals the min-clamps never fire, so the returned split
 * always satisfies `FIXED_OVERHEAD + sidebarVisible + panelMaxRows <= rows`.
 */
export function computeLineageLayout({
  rows,
  panelOpen,
  entryCount,
}: LineageLayoutInput): LineageLayout {
  if (!panelOpen) {
    return { sidebarVisible: VISIBLE_COUNT, panelMaxRows: MAX_PANEL_ROWS };
  }
  const available = rows - FIXED_OVERHEAD;
  let panelBase = Math.floor(available / 2);
  if (entryCount !== undefined && entryCount > 0) {
    panelBase = Math.min(panelBase, entryCount);
  }
  const panelMaxRows = clamp(panelBase, MIN_PANEL_ROWS, MAX_PANEL_ROWS);
  const sidebarVisible = clamp(available - panelMaxRows, SIDEBAR_MIN, VISIBLE_COUNT);
  return { sidebarVisible, panelMaxRows };
}
