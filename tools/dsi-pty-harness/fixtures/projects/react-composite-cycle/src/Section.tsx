import type { ReactElement } from 'react';
import type { HeadingProps } from './Heading.js';
import type { CardProps } from './Card.js';

export interface SectionProps {
  header: ReactElement<HeadingProps>;
  body: ReactElement<CardProps>;
}

export function Section({ header, body }: SectionProps): ReactElement {
  return (
    <section>
      {header}
      {body}
    </section>
  );
}
