interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export default function Button({ label, variant, disabled }: ButtonProps) {
  return (
    <button disabled={disabled} className={variant}>
      {label}
    </button>
  );
}
