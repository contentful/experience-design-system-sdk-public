import type { ReactElement } from 'react';
import type { HeroProps } from './Hero.js';
import type { ArticleProps } from './Article.js';
import type { FooterProps } from './Footer.js';

export interface PageProps {
  hero: ReactElement<HeroProps>;
  article: ReactElement<ArticleProps>;
  footer: ReactElement<FooterProps>;
}

export function Page({ hero, article, footer }: PageProps): ReactElement {
  return (
    <div>
      {hero}
      {article}
      {footer}
    </div>
  );
}
