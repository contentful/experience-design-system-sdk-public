import type { ReactElement } from 'react';
import { Hero } from './Hero.js';
import { Heading } from './Heading.js';
import { Button } from './Button.js';

function useHeroQuery(id: string): { title: string; ctaLabel: string } {
  void id;
  return { title: '', ctaLabel: '' };
}

export interface HeroWithDataProps {
  id: string;
}

export function HeroWithData({ id }: HeroWithDataProps): ReactElement {
  const data = useHeroQuery(id);
  return (
    <Hero
      heading={<Heading text={data.title} />}
      cta={<Button label={data.ctaLabel} />}
    />
  );
}
