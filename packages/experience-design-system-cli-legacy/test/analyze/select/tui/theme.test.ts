import { describe, it, expect } from 'vitest';
import { PALETTE, statusPaletteColor } from '../../../../src/analyze/select/tui/theme.js';

describe('PALETTE (Contentful semantic palette)', () => {
  it('locks the authoritative hex values', () => {
    expect(PALETTE.info).toBe('#1773EB');
    expect(PALETTE.success).toBe('#00C459');
    expect(PALETTE.error).toBe('#E44F20');
    expect(PALETTE.warning).toBe('#FFDA00');
    expect(PALETTE.fg).toBe('#000000');
    expect(PALETTE.inverse).toBe('#FFFFFF');
    expect(PALETTE.muted).toBe('#A6B5C7');
    expect(PALETTE.border).toBe('#C4D1DE');
    expect(PALETTE.subtle).toBe('#DDE5EC');
    expect(PALETTE.bg).toBe('#EFF2F6');
  });
});

describe('statusPaletteColor', () => {
  it('maps accepted → success', () => {
    expect(statusPaletteColor('accepted', 0, 0)).toBe(PALETTE.success);
  });
  it('maps rejected → error', () => {
    expect(statusPaletteColor('rejected', 0, 0)).toBe(PALETTE.error);
  });
  it('maps reviewed → warning', () => {
    expect(statusPaletteColor('reviewed', 0, 0)).toBe(PALETTE.warning);
  });
  it('maps needs-review → muted (NOT inverse/white)', () => {
    expect(statusPaletteColor('needs-review', 0, 0)).toBe(PALETTE.muted);
    expect(statusPaletteColor('needs-review', 0, 0)).not.toBe(PALETTE.inverse);
  });
  it('validation errors override to error', () => {
    expect(statusPaletteColor('accepted', 1, 0)).toBe(PALETTE.error);
  });
  it('validation warnings override to warning', () => {
    expect(statusPaletteColor('accepted', 0, 1)).toBe(PALETTE.warning);
  });
});
