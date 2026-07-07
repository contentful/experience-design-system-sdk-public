import * as React from 'react';

export type BadgeVariant = 'info' | 'success' | 'warning' | 'error';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  compact?: boolean;
}

export function Badge(props: BadgeProps): React.ReactElement {
  const { label, variant = 'info', compact = false } = props;
  return (
    <span data-variant={variant} data-compact={compact ? '' : undefined}>
      {label}
    </span>
  );
}
