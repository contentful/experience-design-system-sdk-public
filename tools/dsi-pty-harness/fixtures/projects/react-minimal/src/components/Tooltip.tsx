import * as React from 'react';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: string;
  placement?: TooltipPlacement;
  delay?: number;
  children?: React.ReactNode;
}

export function Tooltip(props: TooltipProps): React.ReactElement {
  const { content, placement = 'top', delay = 200, children } = props;
  return (
    <span data-placement={placement} data-delay={delay} title={content}>
      {children}
    </span>
  );
}
