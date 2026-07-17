import type { ReactElement } from 'react';

export interface TextProps {
  content: string;
}

export function Text({ content }: TextProps): ReactElement {
  return <p>{content}</p>;
}
