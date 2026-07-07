import * as React from 'react';

export type InputType = 'text' | 'email' | 'password' | 'number';

export interface InputProps {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: InputType;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export function Input(props: InputProps): React.ReactElement {
  const { label, value, onChange, type = 'text', placeholder, required, disabled } = props;
  return (
    <label>
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange?.(e.currentTarget.value)}
      />
    </label>
  );
}
