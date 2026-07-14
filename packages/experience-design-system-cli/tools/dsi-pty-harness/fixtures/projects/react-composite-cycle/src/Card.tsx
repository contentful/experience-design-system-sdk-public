import type { ReactElement } from 'react';
import type { HeadingProps } from './Heading.js';
import type { TextProps } from './Text.js';

export interface CardProps {
  title: ReactElement<HeadingProps>;
  body: ReactElement<TextProps>;
}

export function Card({ title, body }: CardProps): ReactElement {
  return (
    <article>
      {title}
      {body}
    </article>
  );
}
