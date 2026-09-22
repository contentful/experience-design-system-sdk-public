import type { ReactElement } from 'react';
import type { CardProps } from './Card.js';
import type { CalloutProps } from './Callout.js';

export interface ArticleProps {
  content: ReactElement<CardProps>;
  callout: ReactElement<CalloutProps>;
}

export function Article({ content, callout }: ArticleProps): ReactElement {
  return (
    <article>
      {content}
      {callout}
    </article>
  );
}
