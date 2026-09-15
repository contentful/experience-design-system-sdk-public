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
  /** Primary accent: wordmark, focused row, interactive affordances. */
  accent: BRAND.blue,
  success: BRAND.green,
  error: BRAND.orange,
  warning: BRAND.yellow,
  /** Secondary text that stays legible on both light and dark terminals. */
  muted: BRAND.slate,
  /** Frames and rules. */
  border: BRAND.steel,
  inverse: BRAND.white,
} as const;

export type PaletteRole = keyof typeof PALETTE;

/** Marker shown against the focused row of a menu. */
export const FOCUS_MARKER = '❯';

/** Border style for framed chrome such as the home page header. */
export const FRAME_BORDER_STYLE = 'round' as const;
