import type { ReactElement } from 'react';

export interface HeadingProps {
  text: string;
}

export function Heading({ text }: HeadingProps): ReactElement {
  return <h1>{text}</h1>;
}
