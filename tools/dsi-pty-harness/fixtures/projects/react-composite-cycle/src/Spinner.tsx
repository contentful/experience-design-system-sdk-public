import type { ReactElement } from 'react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

export function Spinner({ size = 'md' }: SpinnerProps): ReactElement {
  return <span data-size={size}>...</span>;
}
