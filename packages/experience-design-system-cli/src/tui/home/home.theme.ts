// Contentful brand colours. Fixed, so they do not change with the colour mode.
const BRAND_RAMP = ['#1773EB', '#E44F20', '#FFDA00'] as const;

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
