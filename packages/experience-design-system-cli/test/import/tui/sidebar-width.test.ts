import { describe, expect, it } from 'vitest';
import { computeSidebarWidth } from '../../../src/import/tui/sidebar-width.js';

// INTEG-4412: terminal-width-aware sidebar sizing. Formula is 45% of the
// terminal width, floored at 36 (previous fixed width) and capped at 60.
describe('computeSidebarWidth', () => {
  it('floors at 36 for an 80-col terminal (0.45*80=36)', () => {
    expect(computeSidebarWidth(80)).toBe(36);
  });

  it('returns 45 for a 100-col terminal', () => {
    expect(computeSidebarWidth(100)).toBe(45);
  });

  it('returns 54 for a 120-col terminal', () => {
    expect(computeSidebarWidth(120)).toBe(54);
  });

  it('caps at 60 for a 200-col terminal', () => {
    expect(computeSidebarWidth(200)).toBe(60);
  });

  it('floors at 36 for very narrow terminals (below 80 cols)', () => {
    expect(computeSidebarWidth(40)).toBe(36);
  });
});
