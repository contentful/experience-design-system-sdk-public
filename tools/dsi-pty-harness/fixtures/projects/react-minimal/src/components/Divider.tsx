import * as React from 'react';

export type DividerOrientation = 'horizontal' | 'vertical';

export interface DividerProps {
  orientation?: DividerOrientation;
  label?: string;
}

export function Divider(props: DividerProps): React.ReactElement {
  const { orientation = 'horizontal', label } = props;
  return (
    <div role="separator" data-orientation={orientation}>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
