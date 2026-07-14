import * as React from 'react';

export type IconName = 'check' | 'x' | 'arrow-right' | 'search';
export type IconSize = 'sm' | 'md' | 'lg';

export interface IconProps {
  name: IconName;
  size?: IconSize;
  label?: string;
}

export function Icon(props: IconProps): React.ReactElement {
  const { name, size = 'md', label } = props;
  return (
    <span role="img" aria-label={label ?? name} data-icon={name} data-size={size} />
  );
}
