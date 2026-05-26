type ButtonProps = {
  variant?: 'primary' | 'secondary';
  label: string;
};

export function Button({ variant = 'primary', label }: ButtonProps) {
  return (
    <button className={`button button--${variant}`} type="button">
      {label}
    </button>
  );
}
