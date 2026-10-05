import { describe, it, expect } from 'vitest';
import { computeColumnWindow } from '../../../src/import/tui/steps/ScopeGateStep.js';

describe('computeColumnWindow (added-column scrolling)', () => {
  it('shows everything when the list fits', () => {
    expect(computeColumnWindow(5, 0, 10)).toEqual({ start: 0, end: 5, above: 0, below: 0 });
  });

  it('windows around the cursor when the list overflows', () => {
    const w = computeColumnWindow(100, 50, 10);
    expect(w.end - w.start).toBe(10);
    expect(w.start).toBeLessThanOrEqual(50);
    expect(w.end).toBeGreaterThan(50);
    expect(w.above).toBe(w.start);
    expect(w.below).toBe(100 - w.end);
  });

  it('clamps to the top when the cursor is near the start', () => {
    const w = computeColumnWindow(100, 0, 10);
    expect(w.start).toBe(0);
    expect(w.above).toBe(0);
    expect(w.below).toBe(90);
  });

  it('clamps to the bottom when the cursor is near the end', () => {
    const w = computeColumnWindow(100, 99, 10);
    expect(w.end).toBe(100);
    expect(w.below).toBe(0);
    expect(w.above).toBe(90);
  });

  it('keeps the cursor inside the window at every position', () => {
    for (let cursor = 0; cursor < 40; cursor += 1) {
      const w = computeColumnWindow(40, cursor, 7);
      expect(cursor).toBeGreaterThanOrEqual(w.start);
      expect(cursor).toBeLessThan(w.end);
    }
  });

  it('above + visible + below always equals the total', () => {
    const w = computeColumnWindow(37, 20, 8);
    expect(w.above + (w.end - w.start) + w.below).toBe(37);
  });

  it('handles an empty list', () => {
    expect(computeColumnWindow(0, 0, 10)).toEqual({ start: 0, end: 0, above: 0, below: 0 });
  });
});
