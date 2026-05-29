import React from 'react';

interface AccordionProps extends React.HTMLAttributes<HTMLUListElement> {
  /**
   * Specify the alignment of the chevron inside the accordion header
   * @default end
   */
  align?: 'start' | 'end';
  /**
   * Child nodes to be rendered in the component
   */
  children?: React.ReactNode;
  testId?: string;
}

const AccordionBase = (
  { align = 'end', children, testId = 'cf-ui-accordion', ...props }: AccordionProps,
  ref: React.Ref<HTMLUListElement>,
) => {
  return (
    <ul {...props} ref={ref} data-align={align} data-test-id={testId}>
      {children}
    </ul>
  );
};

AccordionBase.displayName = 'Accordion';

export const Accordion = React.forwardRef(AccordionBase);
