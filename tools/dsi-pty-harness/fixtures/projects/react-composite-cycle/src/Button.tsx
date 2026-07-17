import type { ReactElement } from 'react';

export interface ButtonProps {
  label: string;
  onClick?: () => void;
}

export function Button({ label, onClick }: ButtonProps): ReactElement {
  return <button onClick={onClick}>{label}</button>;
}
