// Forma 36 adjacent palette
const DARK = {
  text: '#f7f9fa', // gray/100
  muted: '#aec1cc', // gray/400
  border: '#aec1cc', // gray/400
  accent: '#40a0ff', // blue/400
  error: '#ff707d', // red/400
  success: '#00C459',
  warning: '#FFDA00',
} as const;

const LIGHT = {
  text: '#111b2b', // gray/900
  muted: '#5a657c', // gray/600
  border: '#5a657c', // gray/600
  accent: '#0059c8', // blue/600, semantic primary
  error: '#bd002a', // semantic negative
  success: '#00C459',
  warning: '#FFDA00',
} as const;

export type ColorMode = 'dark' | 'light';

// Read the terminal background from COLORFGBG ("fg;bg", set by many terminals; bg 7 and 15 are light). Default to dark mode if unset or unrecognized.
export function detectColorMode(env: NodeJS.ProcessEnv = process.env): ColorMode {
  const bg = env.COLORFGBG?.split(';').pop();
  if (bg === '7' || bg === '15') return 'light';
  return 'dark';
}

export const PALETTE = detectColorMode() === 'light' ? LIGHT : DARK;
