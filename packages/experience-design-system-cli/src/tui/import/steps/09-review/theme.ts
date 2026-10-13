import { PALETTE as BRAND } from '../../../home/home.theme.js';

// The review's colours. Same values as legacy's PALETTE, so nothing looks different: `info` is v2's `accent` (both
// #1773EB) and the rest are v2's brand colours. `inverse` is legacy's, which v2's brand palette has no name for.
export const PALETTE = {
  info: BRAND.accent,
  success: BRAND.success,
  error: BRAND.error,
  warning: BRAND.warning,
  muted: BRAND.muted,
  border: BRAND.border,
  inverse: '#FFFFFF',
} as const;
