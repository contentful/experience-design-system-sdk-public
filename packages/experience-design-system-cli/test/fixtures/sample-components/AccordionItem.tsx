import React from 'react';
type HeadingElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

import { AccordionHeader } from './AccordionHeader';
import { AccordionPanel } from './AccordionPanel';

interface AccordionItemProps {
  /**
   * The accordion title
   */
  title?: React.ReactNode;
  /**
   * The heading element that will be used by the AccordionHeader
   */
  titleElement?: HeadingElement;
  /**
   * The children of the AccordionItem are in fact the content of the accordion
   */
  children?: React.ReactNode;
  /**
   * A function to be called when the accordion item is opened
   */
  onExpand?: () => void;
  /**
   * A function to be called when the accordion item is closed
   */
  onCollapse?: () => void;
  /**
   * Controls whether the item is expanded
   */
  isExpanded?: boolean;

  testId?: string;
}

const AccordionItemBase = (
  {
    title = 'Accordion Title',
    titleElement = 'h2',
    testId = 'cf-ui-accordion-item',
    onExpand,
    onCollapse,
    children,
    isExpanded = false,
    ...props
  }: AccordionItemProps,
  ref: React.Ref<HTMLLIElement>,
) => {
  const handleOnClick = () => {
    if (isExpanded) {
      onCollapse?.();
    } else {
      onExpand?.();
    }
  };

  return (
    <li {...props} ref={ref} data-test-id={testId}>
      <AccordionHeader onClick={handleOnClick} isExpanded={isExpanded} element={titleElement} ariaId="1">
        {title}
      </AccordionHeader>

      <AccordionPanel ariaId="1" isExpanded={isExpanded}>
        {children}
      </AccordionPanel>
    </li>
  );
};

AccordionItemBase.displayName = 'AccordionItem';

export const AccordionItem = React.forwardRef(AccordionItemBase);
