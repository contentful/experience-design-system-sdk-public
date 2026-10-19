import { describe, expect, it } from 'vitest';
import { detectColorMode } from '../../src/tui/theme.js';

describe('detectColorMode', () => {
  it('defaults to dark', () => {
    expect(detectColorMode({})).toBe('dark');
  });

  it('reads a light background from COLORFGBG', () => {
    expect(detectColorMode({ COLORFGBG: '0;15' })).toBe('light');
    expect(detectColorMode({ COLORFGBG: '0;default;7' })).toBe('light');
  });

  it('reads a dark background from COLORFGBG', () => {
    expect(detectColorMode({ COLORFGBG: '15;0' })).toBe('dark');
  });
});
