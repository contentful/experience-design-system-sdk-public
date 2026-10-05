type IconProps = {
  name: string;
  size?: 'sm' | 'md' | 'lg';
};

export function Icon({ name, size = 'md' }: IconProps) {
  return <span className={`icon icon--${name} icon--${size}`} />;
}
