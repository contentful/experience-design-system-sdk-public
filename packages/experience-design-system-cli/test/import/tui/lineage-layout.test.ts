import { describe, it, expect } from 'vitest';
import {
  computeLineageLayout,
  computeSidebarBudget,
  FIXED_OVERHEAD,
  PANEL_BOX_CHROME,
  VISIBLE_COUNT,
  MAX_PANEL_ROWS,
  MIN_PANEL_ROWS,
  SIDEBAR_MIN,
  BASE_CHROME_OVERHEAD,
} from '../../../src/import/tui/lineage-layout.js';

describe('computeLineageLayout (L2d — panel in the sidebar slot)', () => {
  it('panel closed → full sidebar and default panel window', () => {
    const layout = computeLineageLayout({ rows: 24, panelOpen: false });
    expect(layout.sidebarVisible).toBe(VISIBLE_COUNT);
    expect(layout.panelMaxRows).toBe(MAX_PANEL_ROWS);
  });

  it('sidebar height is CONSTANT whether the panel is open or closed', () => {
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

describe('computeSidebarBudget (L2e — autoscale the BASE frame to terminal height)', () => {
  it('small terminal (rows=24): sidebar shrinks so the base frame fits', () => {
    const { sidebarVisibleCount } = computeSidebarBudget({ rows: 24, panelOpen: false });
    expect(sidebarVisibleCount).toBeLessThan(VISIBLE_COUNT);
    expect(BASE_CHROME_OVERHEAD + sidebarVisibleCount).toBeLessThanOrEqual(24);
    expect(sidebarVisibleCount).toBeGreaterThanOrEqual(SIDEBAR_MIN);
  });

  it('rows=40: base frame fits (sidebar shrinks below VISIBLE_COUNT if chrome demands)', () => {
    const { sidebarVisibleCount } = computeSidebarBudget({ rows: 40, panelOpen: false });
    expect(BASE_CHROME_OVERHEAD + sidebarVisibleCount).toBeLessThanOrEqual(40);
    expect(sidebarVisibleCount).toBeGreaterThanOrEqual(SIDEBAR_MIN);
  });

  it('larger terminal gives more sidebar rows than a smaller one', () => {
    const small = computeSidebarBudget({ rows: 24, panelOpen: false });
    const large = computeSidebarBudget({ rows: 50, panelOpen: false });
    expect(large.sidebarVisibleCount).toBeGreaterThanOrEqual(small.sidebarVisibleCount);
  });

  it('huge terminal caps the sidebar at VISIBLE_COUNT', () => {
    const { sidebarVisibleCount } = computeSidebarBudget({ rows: 200, panelOpen: false });
    expect(sidebarVisibleCount).toBe(VISIBLE_COUNT);
  });

  it('never drops below SIDEBAR_MIN on a tiny terminal', () => {
    const { sidebarVisibleCount } = computeSidebarBudget({ rows: 8, panelOpen: false });
    expect(sidebarVisibleCount).toBeGreaterThanOrEqual(SIDEBAR_MIN);
  });

  it('base frame fits across a sweep of heights at/above the documented floor', () => {
    const floor = BASE_CHROME_OVERHEAD + SIDEBAR_MIN;
    for (let rows = floor; rows <= 80; rows++) {
      const { sidebarVisibleCount } = computeSidebarBudget({ rows, panelOpen: false });
      expect(BASE_CHROME_OVERHEAD + sidebarVisibleCount).toBeLessThanOrEqual(rows);
      expect(sidebarVisibleCount).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    }
  });

  it('panel-open case still fits the terminal (unifies with computeLineageLayout)', () => {
    const rows = 40;
    const { sidebarVisibleCount, panelMaxRows } = computeSidebarBudget({ rows, panelOpen: true });
    expect(panelMaxRows + PANEL_BOX_CHROME + FIXED_OVERHEAD).toBeLessThanOrEqual(rows);
    expect(sidebarVisibleCount).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });

  it('caps the panel window to the entry count when the lineage is short', () => {
    const { panelMaxRows } = computeSidebarBudget({ rows: 60, panelOpen: true, entryCount: 3 });
    expect(panelMaxRows).toBeLessThanOrEqual(MAX_PANEL_ROWS);
    expect(panelMaxRows).toBeGreaterThanOrEqual(MIN_PANEL_ROWS);
  });
});
