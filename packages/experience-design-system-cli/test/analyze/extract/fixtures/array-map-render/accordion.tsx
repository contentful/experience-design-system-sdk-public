import { useState } from 'react';
import { AccordionItem } from './accordion-item.js';

export type AccordionEntry = {
  title: string;
  content: React.ReactNode;
};

export type AccordionProps = {
  items: AccordionEntry[];
  defaultOpenIndex?: number | null;
  className?: string;
};

export function Accordion({ items, defaultOpenIndex = null, className }: AccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(defaultOpenIndex);
  const handleToggle = (index: number) => setOpenIndex((prev) => (prev === index ? null : index));

  return (
    <div className={className}>
      {items.map((item, index) => (
        <AccordionItem
          key={item.title}
          title={item.title}
          isOpen={openIndex === index}
          onToggle={() => handleToggle(index)}
        >
          {item.content}
        </AccordionItem>
      ))}
    </div>
  );
}
