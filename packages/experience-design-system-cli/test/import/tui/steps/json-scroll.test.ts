import { describe, it, expect } from 'vitest';
import { computeNextJsonOffset } from '../../../../src/import/tui/steps/json-scroll.js';

// totalLines = 20, panelHeight = 5 → maxOffset = 15
const TOTAL = 20;
const HEIGHT = 5;

function k(overrides: Partial<{ upArrow: boolean; downArrow: boolean; pageUp: boolean; pageDown: boolean; ctrl: boolean }> = {}) {
  return {
    upArrow: false,
    downArrow: false,
    pageUp: false,
    pageDown: false,
    ctrl: false,
    ...overrides,
  };
}

describe('computeNextJsonOffset', () => {
  it('j at offset 0 returns 1', () => {
    expect(computeNextJsonOffset(0, 'j', k(), TOTAL, HEIGHT)).toBe(1);
  });
  it('k at offset 0 clamps to 0', () => {
    expect(computeNextJsonOffset(0, 'k', k(), TOTAL, HEIGHT)).toBe(0);
  });
  it('j at offset 15 clamps to maxOffset', () => {
    expect(computeNextJsonOffset(15, 'j', k(), TOTAL, HEIGHT)).toBe(15);
  });
  it('Ctrl+d at offset 0 returns half-page (floor(5/2)=2)', () => {
    expect(computeNextJsonOffset(0, 'd', k({ ctrl: true }), TOTAL, HEIGHT)).toBe(2);
  });
  it('Ctrl+u at offset 10 returns 8', () => {
    expect(computeNextJsonOffset(10, 'u', k({ ctrl: true }), TOTAL, HEIGHT)).toBe(8);
  });
  it('PageDown at offset 0 returns 5', () => {
    expect(computeNextJsonOffset(0, '', k({ pageDown: true }), TOTAL, HEIGHT)).toBe(5);
  });
  it('PageUp at offset 10 returns 5', () => {
    expect(computeNextJsonOffset(10, '', k({ pageUp: true }), TOTAL, HEIGHT)).toBe(5);
  });
  it('G at offset 0 jumps to maxOffset', () => {
    expect(computeNextJsonOffset(0, 'G', k(), TOTAL, HEIGHT)).toBe(15);
  });
  it('downArrow behaves like j', () => {
    expect(computeNextJsonOffset(0, '', k({ downArrow: true }), TOTAL, HEIGHT)).toBe(1);
  });
  it('upArrow behaves like k', () => {
    expect(computeNextJsonOffset(5, '', k({ upArrow: true }), TOTAL, HEIGHT)).toBe(4);
  });
  it('returns null for unrelated input (no change)', () => {
    expect(computeNextJsonOffset(5, 'x', k(), TOTAL, HEIGHT)).toBeNull();
  });
  it('PageDown clamps at maxOffset', () => {
    expect(computeNextJsonOffset(14, '', k({ pageDown: true }), TOTAL, HEIGHT)).toBe(15);
  });
  it('Ctrl+u clamps at 0', () => {
    expect(computeNextJsonOffset(1, 'u', k({ ctrl: true }), TOTAL, HEIGHT)).toBe(0);
  });
});
