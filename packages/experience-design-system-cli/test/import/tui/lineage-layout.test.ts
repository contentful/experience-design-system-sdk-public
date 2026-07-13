import { describe, it, expect } from 'vitest';
import {
  computeLineageLayout,
  FIXED_OVERHEAD,
  VISIBLE_COUNT,
  MAX_PANEL_ROWS,
  MIN_PANEL_ROWS,
  SIDEBAR_MIN,
} from '../../../src/import/tui/lineage-layout.js';

describe('computeLineageLayout', () => {
  it('panel closed → full sidebar and default panel window', () => {
    const layout = computeLineageLayout({ rows: 24, panelOpen: false });
    expect(layout.sidebarVisible).toBe(VISIBLE_COUNT);
    expect(layout.panelMaxRows).toBe(MAX_PANEL_ROWS);
  });

  it('panel open on a small terminal (rows=24) fits the budget and both stay at their mins', () => {
    const rows = 24;
    const { sidebarVisible, panelMaxRows } = computeLineageLayout({ rows, panelOpen: true });
    expect(sidebarVisible + panelMaxRows + FIXED_OVERHEAD).toBeLessThanOrEqual(rows);
    expect(sidebarVisible).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });

  it('panel open on a large terminal (rows=60) gives both more room, still within budget', () => {
    const small = computeLineageLayout({ rows: 24, panelOpen: true });
    const large = computeLineageLayout({ rows: 60, panelOpen: true });
    expect(large.sidebarVisible).toBeGreaterThan(small.sidebarVisible);
    expect(large.panelMaxRows).toBeGreaterThan(small.panelMaxRows);
    expect(large.sidebarVisible + large.panelMaxRows + FIXED_OVERHEAD).toBeLessThanOrEqual(60);
  });

  it('never exceeds VISIBLE_COUNT or MAX_PANEL_ROWS on a huge terminal', () => {
    const { sidebarVisible, panelMaxRows } = computeLineageLayout({ rows: 200, panelOpen: true });
    expect(sidebarVisible).toBeLessThanOrEqual(VISIBLE_COUNT);
    expect(panelMaxRows).toBeLessThanOrEqual(MAX_PANEL_ROWS);
  });

  it('never drops below the mins on a tiny terminal', () => {
    const { sidebarVisible, panelMaxRows } = computeLineageLayout({ rows: 10, panelOpen: true });
    expect(sidebarVisible).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });

  it('caps the panel window to the entry count when the lineage is short', () => {
    const { panelMaxRows } = computeLineageLayout({ rows: 60, panelOpen: true, entryCount: 3 });
    expect(panelMaxRows).toBeLessThanOrEqual(MAX_PANEL_ROWS);
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });

  it('invariant holds across a sweep of realistic terminal heights when open', () => {
    // Floor = FIXED_OVERHEAD + SIDEBAR_MIN + MIN_PANEL_ROWS; below it the mins
    // (usability) intentionally win over the fit. At/above it the frame fits.
    const floor = FIXED_OVERHEAD + SIDEBAR_MIN + MIN_PANEL_ROWS;
    for (let rows = floor; rows <= 80; rows++) {
      const { sidebarVisible, panelMaxRows } = computeLineageLayout({ rows, panelOpen: true });
      expect(sidebarVisible + panelMaxRows + FIXED_OVERHEAD).toBeLessThanOrEqual(rows);
    }
  });
});
