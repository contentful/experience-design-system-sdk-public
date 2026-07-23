import type { ReactElement } from 'react';

export interface AProps {
  a: string;
}
export function A({ a }: AProps) {
  return <span>{a}</span>;
}

export interface BProps {
  b: number;
}
export function B({ b }: BProps) {
  return <span>{b}</span>;
}

export interface WrapperProps {
  content: ReactElement<AProps> | ReactElement<BProps>;
}

export function Wrapper({ content }: WrapperProps) {
  return <div>{content}</div>;
}
