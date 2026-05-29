import React from 'react';

type HeadingElement = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

interface AccordionHeaderProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Child nodes to be rendered in the component
   */
  children?: React.ReactNode;
  /**
   * The function that will be called once the user clicks on the accordion title
   */
  onClick: VoidFunction;
  /**
   * A boolean that tells if the accordion should be expanded or collapsed
   */
  isExpanded?: boolean;
  /**
   * A unique id that is necessary for the aria roles and properties
   */
  ariaId: string;
  /**
   * The heading element that wraps the trigger button
   */
  element?: HeadingElement;

  testId?: string;
}

export const AccordionHeader = ({
  children,
  onClick,
  isExpanded = false,
  ariaId,
  element = 'h2',
  testId = 'cf-ui-accordion-header',
  ...buttonProps
}: AccordionHeaderProps) => {
  const HeadingTag = element;

  return (
    <HeadingTag>
      <button
        {...buttonProps}
        type="button"
        data-test-id={testId}
        aria-expanded={isExpanded}
        aria-controls={`accordion-panel--${ariaId}`}
        id={`accordion--${ariaId}`}
        onClick={onClick}
      >
        <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
        {children}
      </button>
    </HeadingTag>
  );
};
