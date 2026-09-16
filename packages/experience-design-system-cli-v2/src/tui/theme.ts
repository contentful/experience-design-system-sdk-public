/**
 * Contentful brand theme
 */
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

/**
 * Semantic roles. Screens reference these, never BRAND directly, so a brand
 * refresh is a one-line change here.
 */
export const PALETTE = {
  /** Primary accent: focused row and interactive affordances. */
  accent: BRAND.blue,
  /** Headings, and text sitting on a colored background. */
  heading: BRAND.white,
  success: BRAND.green,
  error: BRAND.orange,
  warning: BRAND.yellow,
  /** Secondary text that stays legible on both light and dark terminals. */
  muted: BRAND.slate,
  /** Frames and rules. */
  border: BRAND.steel,
} as const;

export type PaletteRole = keyof typeof PALETTE;

/**
 * The three brand colors in display order: blue → orange → yellow.
 *
 * Blue leads so the primary accent stays dominant, with the warmer colors
 * reading as accompaniment.
 */
export const BRAND_RAMP = [BRAND.blue, BRAND.orange, BRAND.yellow] as const;

/** Cell used to draw the brand bar. */
const BAR_CELL = '━';

/**
 * A tri-color brand bar: one segment per ramp color, exactly `width` cells wide.
 *
 * Unlike a gradient this uses only the literal brand values — no interpolated
 * in-between hues — so the accent stays recognizably Contentful.
 */
export function brandBar(width: number, ramp: readonly string[] = BRAND_RAMP): { text: string; color: string }[] {
  if (width <= 0 || ramp.length === 0) return [];

  const base = Math.floor(width / ramp.length);
  const remainder = width % ramp.length;

  return ramp
    .map((color, i) => ({
      // Spread the leftover cells across the leading segments so the bar lands
      // on exactly `width` regardless of divisibility.
      text: BAR_CELL.repeat(base + (i < remainder ? 1 : 0)),
      color,
    }))
    .filter((segment) => segment.text.length > 0);
}

/** Marker shown against the focused row of a menu. */
export const FOCUS_MARKER = '❯';

/** Border style for framed chrome such as the home page header. */
export const FRAME_BORDER_STYLE = 'round' as const;
