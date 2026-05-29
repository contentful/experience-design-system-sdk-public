import React from 'react';

interface AccordionPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Child nodes to be rendered in the component
   */
  children?: React.ReactNode;
  /**
   * A boolean that tells if the accordion should be expanded or collapsed
   */
  isExpanded: boolean;
  /**
   * A unique id that is necessary for the aria roles and properties
   */
  ariaId: string | number;

  testId?: string;
}

export const AccordionPanel = ({
  children,
  isExpanded = false,
  ariaId,
  testId = 'cf-ui-accordion-panel',
  ...props
}: AccordionPanelProps) => {
  if (!isExpanded) {
    return null;
  }

  return (
    <div {...props} data-test-id={testId} aria-labelledby={`accordion--${ariaId}`} id={`accordion-panel--${ariaId}`}>
      {children}
    </div>
  );
};
