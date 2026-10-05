import type { ReactNode } from 'react';

export type AccordionItemProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
  children?: ReactNode;
};

export function AccordionItem({ title, isOpen, onToggle, className, children }: AccordionItemProps) {
  return (
    <div className={className}>
      <button type="button" onClick={onToggle} aria-expanded={isOpen}>
        {title}
      </button>
      {isOpen ? <div>{children}</div> : null}
    </div>
  );
}
