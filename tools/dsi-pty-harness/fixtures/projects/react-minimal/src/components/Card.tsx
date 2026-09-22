import * as React from 'react';

export interface CardProps {
  title: string;
  subtitle?: string;
  padding?: 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
}

export function Card(props: CardProps): React.ReactElement {
  const { title, subtitle, padding = 'md', children } = props;
  return (
    <section data-padding={padding}>
      <header>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}
