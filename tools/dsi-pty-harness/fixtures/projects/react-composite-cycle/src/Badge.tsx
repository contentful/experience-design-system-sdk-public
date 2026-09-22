import type { ReactElement } from 'react';

export interface BadgeProps {
  label: string;
}

export function Badge({ label }: BadgeProps): ReactElement {
  return <span>{label}</span>;
}
