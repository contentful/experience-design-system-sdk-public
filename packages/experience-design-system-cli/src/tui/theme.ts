// Forma 36 adjacent palette: https://f36.contentful.com/tokens/color-system
const DARK = {
  text: '#f7f9fa', // gray100
  muted: '#aec1cc', // gray400
  border: '#aec1cc', // gray400
  accent: '#40a0ff', // blue400
  error: '#ff707d', // red400
  success: '#5DB057', // green400
  warning: '#FFC835', // yellow500
} as const;

const LIGHT = {
  text: '#111b2b', // gray900
  muted: '#5a657c', // gray600
  border: '#5a657c', // gray600
  accent: '#0059c8', // semantic primary
  error: '#bd002a', // semantic negative
  success: '#006D23', // semantic positive
  warning: '#CC4500', // semantic warning
} as const;

export type ColorMode = 'dark' | 'light';

// Read the terminal background from COLORFGBG ("fg;bg", set by many terminals; bg 7 and 15 are light). Default to dark mode if unset or unrecognized.
export function detectColorMode(env: NodeJS.ProcessEnv = process.env): ColorMode {
  const bg = env.COLORFGBG?.split(';').pop();
  if (bg === '7' || bg === '15') return 'light';
  return 'dark';
}

export const PALETTE = detectColorMode() === 'light' ? LIGHT : DARK;
