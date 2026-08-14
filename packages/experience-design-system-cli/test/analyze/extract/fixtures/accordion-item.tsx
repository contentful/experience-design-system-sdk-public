import type { ReactNode } from 'react';

export interface AccordionItemProps {
  title: string;
  children?: ReactNode;
}

export function AccordionItem({ title, children }: AccordionItemProps) {
  return (
    <section>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}
