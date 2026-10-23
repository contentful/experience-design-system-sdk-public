import React from 'react';
import { Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import type { PreviewAnnotation } from '../types.js';

export type PreviewBadgeValue = { char: string; color: string; bold?: boolean; dim?: boolean };

export function previewBadge(annotation: PreviewAnnotation | undefined): PreviewBadgeValue | null {
  switch (annotation) {
    case 'new':
      return { char: '+', color: PALETTE.success };
    case 'changed':
      return { char: '~', color: PALETTE.warning };
    case 'removed':
      return { char: '-', color: PALETTE.error, dim: true };
    case 'breaking':
      return { char: '!', color: PALETTE.error, bold: true };
    default:
      return null;
  }
}

export function PreviewBadge({
  badge,
  highlighted = false,
}: {
  badge: PreviewBadgeValue | null;
  highlighted?: boolean;
}): React.ReactElement {
  return badge ? (
    <Text color={!highlighted && badge.dim ? PALETTE.muted : badge.color} bold={badge.bold}>
      {badge.char}
    </Text>
  ) : (
    <Text> </Text>
  );
}
