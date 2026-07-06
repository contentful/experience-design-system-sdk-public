import * as React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): React.ReactElement {
  const { label, variant = 'primary', disabled = false, onClick, children } = props;
  return (
    <button data-variant={variant} disabled={disabled} onClick={onClick}>
      {label}
      {children}
    </button>
  );
}
