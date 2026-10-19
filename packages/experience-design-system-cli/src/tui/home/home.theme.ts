import { PALETTE } from '../theme.js';

const BRAND_RAMP = [PALETTE.accent, PALETTE.error, PALETTE.warning] as const;

const BAR_CELL = '━';

export function brandBar(width: number, ramp: readonly string[] = BRAND_RAMP): { text: string; color: string }[] {
  if (width <= 0 || ramp.length === 0) return [];

  const base = Math.floor(width / ramp.length);
  const remainder = width % ramp.length;

  return ramp
    .map((color, i) => ({
      text: BAR_CELL.repeat(base + (i < remainder ? 1 : 0)),
      color,
    }))
    .filter((segment) => segment.text.length > 0);
}

export const FOCUS_MARKER = '❯';
