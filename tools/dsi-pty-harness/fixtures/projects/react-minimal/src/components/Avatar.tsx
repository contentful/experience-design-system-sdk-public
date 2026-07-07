import * as React from 'react';

export type AvatarShape = 'circle' | 'square';

export interface AvatarProps {
  src?: string;
  alt: string;
  shape?: AvatarShape;
  size?: 'sm' | 'md' | 'lg';
}

export function Avatar(props: AvatarProps): React.ReactElement {
  const { src, alt, shape = 'circle', size = 'md' } = props;
  return <img src={src} alt={alt} data-shape={shape} data-size={size} />;
}
