import { describe, it, expect } from 'vitest';
import {
  cycleLineCount,
  cycleLineOffsets,
  totalCyclePanelLines,
  followCycleScroll,
  CYCLE_PANEL_PREAMBLE_LINES,
} from '../../../src/import/tui/cycle-panel-scroll.js';

const withBreak = { suggestedBreak: { fromComponent: 'A', slotName: 's', toComponent: 'B' } };
const noBreak = { suggestedBreak: null };

describe('cycle-panel-scroll helper', () => {
  it('cycleLineCount is 4 with a suggestedBreak, 3 without', () => {
    expect(cycleLineCount(withBreak)).toBe(4);
    expect(cycleLineCount(noBreak)).toBe(3);
  });

  it('cycleLineOffsets accounts for the preamble and variable per-cycle counts', () => {
    const cycles = [withBreak, noBreak, withBreak];
    const offsets = cycleLineOffsets(cycles);
    expect(offsets[0]).toBe(CYCLE_PANEL_PREAMBLE_LINES);
    expect(offsets[1]).toBe(CYCLE_PANEL_PREAMBLE_LINES + 4);
    expect(offsets[2]).toBe(CYCLE_PANEL_PREAMBLE_LINES + 4 + 3);
  });

  it('totalCyclePanelLines sums preamble + all cycle line counts', () => {
    const cycles = [withBreak, noBreak];
    expect(totalCyclePanelLines(cycles)).toBe(CYCLE_PANEL_PREAMBLE_LINES + 4 + 3);
  });

  it('followCycleScroll scrolls down so a cycle below the window becomes visible', () => {
    // 10 cycles, each with a break => 4 lines each; PANEL_H = 20.
    const cycles = Array.from({ length: 10 }, () => ({ ...withBreak }));
    // Cursor on cycle index 6: its block starts at 4 + 6*4 = 28, well below 0..20.
    const next = followCycleScroll(0, 6, cycles, 20);
    const start = cycleLineOffsets(cycles)[6];
    expect(next).toBeGreaterThan(0);
    expect(start).toBeGreaterThanOrEqual(next);
    expect(start).toBeLessThan(next + 20);
  });

  it('followCycleScroll scrolls up so a cycle above the window becomes visible', () => {
    const cycles = Array.from({ length: 10 }, () => ({ ...withBreak }));
    // Start scrolled down; cursor on cycle 0 (start line 4) is above the window.
    const next = followCycleScroll(28, 0, cycles, 20);
    expect(next).toBeLessThanOrEqual(cycleLineOffsets(cycles)[0]);
  });

  it('followCycleScroll leaves scroll unchanged when the cycle is already visible', () => {
    const cycles = Array.from({ length: 10 }, () => ({ ...withBreak }));
    expect(followCycleScroll(0, 1, cycles, 20)).toBe(0);
  });

  it('followCycleScroll clamps to the max offset', () => {
    const cycles = Array.from({ length: 10 }, () => ({ ...withBreak }));
    const next = followCycleScroll(0, 9, cycles, 20);
    const maxOffset = totalCyclePanelLines(cycles) - 20;
    expect(next).toBeLessThanOrEqual(maxOffset);
  });
});
