import type { ReactElement } from 'react';

export interface HeadingProps {
  text: string;
  level?: 1 | 2 | 3;
}

export function Heading({ text, level = 1 }: HeadingProps) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
  return <Tag>{text}</Tag>;
}

export interface CardProps {
  title: string;
  header?: ReactElement<HeadingProps>;
}

export function Card({ title, header }: CardProps) {
  return (
    <section>
      {header}
      <h2>{title}</h2>
    </section>
  );
}
