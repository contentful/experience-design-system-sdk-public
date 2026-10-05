export const BRAND = {
  blue: '#1773EB',
  green: '#00C459',
  orange: '#E44F20',
  yellow: '#FFDA00',
  white: '#FFFFFF',
  slate: '#A6B5C7',
  steel: '#C4D1DE',
  mist: '#DDE5EC',
  fog: '#EFF2F6',
} as const;

export const PALETTE = {
  accent: BRAND.blue,
  heading: BRAND.white,
  success: BRAND.green,
  error: BRAND.orange,
  warning: BRAND.yellow,
  muted: BRAND.slate,
  border: BRAND.steel,
} as const;

const BRAND_RAMP = [BRAND.blue, BRAND.orange, BRAND.yellow] as const;

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
