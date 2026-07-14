import type { ReactElement } from 'react';

export interface FooterProps {
  copyright: string;
}

export function Footer({ copyright }: FooterProps): ReactElement {
  return <footer>{copyright}</footer>;
}
