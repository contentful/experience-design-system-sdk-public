import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { AccordionItem, type AccordionItemProps } from './accordion-item.js';

export interface AccordionProps {
  /**
   * Compose AccordionItem rows only — narrowed at runtime below, not declared
   * as ReactElement<AccordionItemProps> here, mirroring blue-accordion's
   * bare `children: ReactNode` slot.
   */
  children?: ReactNode;
}

function isAccordionItemElement(child: ReactNode): child is ReactElement<AccordionItemProps> {
  return isValidElement(child) && child.type === AccordionItem;
}

export function Accordion({ children }: AccordionProps) {
  const rendered = Children.map(children, (child) => (isAccordionItemElement(child) ? child : null));
  return <div>{rendered}</div>;
}
