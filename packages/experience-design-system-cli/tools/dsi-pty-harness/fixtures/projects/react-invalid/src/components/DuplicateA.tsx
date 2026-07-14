import * as React from 'react';

export interface DuplicateProps {
  label: string;
}

export function Duplicate(props: DuplicateProps): React.ReactElement {
  return <span>{props.label}</span>;
}
