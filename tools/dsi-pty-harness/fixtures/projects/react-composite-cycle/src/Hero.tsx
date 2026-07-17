import type { ReactElement } from 'react';
import type { HeadingProps } from './Heading.js';
import type { ButtonProps } from './Button.js';

export interface HeroProps {
  heading: ReactElement<HeadingProps>;
  cta: ReactElement<ButtonProps>;
}

export function Hero({ heading, cta }: HeroProps): ReactElement {
  return (
    <section>
      {heading}
      {cta}
    </section>
  );
}
