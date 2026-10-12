import { PALETTE as BRAND } from '../../../../home/home.theme.js';

// The gate's colours. Same values as legacy's PALETTE; `info` is v2's `accent` (both #1773EB). Everything else is v2's.
export const PALETTE = {
  info: BRAND.accent,
  success: BRAND.success,
  error: BRAND.error,
  warning: BRAND.warning,
  muted: BRAND.muted,
  border: BRAND.border,
} as const;
