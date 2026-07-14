import type { ReviewComponentStatus } from '../types.js';

export const PALETTE = {
  info: '#1773EB',
  success: '#00C459',
  error: '#E44F20',
  warning: '#FFDA00',
  fg: '#000000',
  inverse: '#FFFFFF',
  muted: '#A6B5C7',
  border: '#C4D1DE',
  subtle: '#DDE5EC',
  bg: '#EFF2F6',
} as const;

export type PaletteRole = keyof typeof PALETTE;

export function statusPaletteColor(
  status: ReviewComponentStatus,
  validationErrorCount: number,
  validationWarningCount: number,
): string {
  if (validationErrorCount > 0) return PALETTE.error;
  if (validationWarningCount > 0) return PALETTE.warning;
  switch (status) {
    case 'accepted':
      return PALETTE.success;
    case 'rejected':
      return PALETTE.error;
    case 'reviewed':
      return PALETTE.warning;
    case 'needs-review':
      return PALETTE.muted;
  }
}
