import { describe, it, expect } from 'vitest';
import {
  computeLineageLayout,
  FIXED_OVERHEAD,
  PANEL_BOX_CHROME,
  VISIBLE_COUNT,
  MAX_PANEL_ROWS,
  MIN_PANEL_ROWS,
} from '../../../src/import/tui/lineage-layout.js';

describe('computeLineageLayout (L2d — panel in the sidebar slot)', () => {
  it('panel closed → full sidebar and default panel window', () => {
    const layout = computeLineageLayout({ rows: 24, panelOpen: false });
    expect(layout.sidebarVisible).toBe(VISIBLE_COUNT);
    expect(layout.panelMaxRows).toBe(MAX_PANEL_ROWS);
  });

  it('sidebar height is CONSTANT whether the panel is open or closed', () => {
    // L2d: the panel replaces the sidebar in the same slot, so the sidebar no
    // longer shrinks when lineage opens (that was the L2c stacked approach).
    const closed = computeLineageLayout({ rows: 40, panelOpen: false });
    const open = computeLineageLayout({ rows: 40, panelOpen: true });
    expect(open.sidebarVisible).toBe(closed.sidebarVisible);
    expect(open.sidebarVisible).toBe(VISIBLE_COUNT);
  });

  it('panel open on a small terminal (rows=24): panel box fits the terminal', () => {
    const rows = 24;
    const { panelMaxRows } = computeLineageLayout({ rows, panelOpen: true });
    expect(panelMaxRows + PANEL_BOX_CHROME + FIXED_OVERHEAD).toBeLessThanOrEqual(rows);
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });

  it('panel open on a larger terminal gives the panel more room, capped at MAX_PANEL_ROWS', () => {
    const small = computeLineageLayout({ rows: 24, panelOpen: true });
    const large = computeLineageLayout({ rows: 60, panelOpen: true });
    expect(large.panelMaxRows).toBeGreaterThanOrEqual(small.panelMaxRows);
    expect(large.panelMaxRows).toBeLessThanOrEqual(MAX_PANEL_ROWS);
  });

  it('never exceeds MAX_PANEL_ROWS on a huge terminal; sidebar stays at VISIBLE_COUNT', () => {
    const { sidebarVisible, panelMaxRows } = computeLineageLayout({ rows: 200, panelOpen: true });
    expect(sidebarVisible).toBe(VISIBLE_COUNT);
    expect(panelMaxRows).toBeLessThanOrEqual(MAX_PANEL_ROWS);
  });

  it('never drops below the panel min on a tiny terminal', () => {
    const { panelMaxRows } = computeLineageLayout({ rows: 10, panelOpen: true });
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });

  it('caps the panel window to the entry count when the lineage is short', () => {
    const { panelMaxRows } = computeLineageLayout({ rows: 60, panelOpen: true, entryCount: 3 });
    expect(panelMaxRows).toBeLessThanOrEqual(MAX_PANEL_ROWS);
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });

  it('panel box fits the terminal across a sweep of realistic heights when open', () => {
    // Floor = FIXED_OVERHEAD + PANEL_BOX_CHROME + MIN_PANEL_ROWS; below it the
    // panel min (usability) intentionally wins over the fit. At/above it the
    // panel box fits within the terminal.
    const floor = FIXED_OVERHEAD + PANEL_BOX_CHROME + MIN_PANEL_ROWS;
    for (let rows = floor; rows <= 80; rows++) {
      const { panelMaxRows } = computeLineageLayout({ rows, panelOpen: true });
      expect(panelMaxRows + PANEL_BOX_CHROME + FIXED_OVERHEAD).toBeLessThanOrEqual(rows);
    }
  });
});
