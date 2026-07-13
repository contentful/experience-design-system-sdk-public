import * as React from 'react';

export interface DuplicateProps2 {
  title: string;
}

export function Duplicate(props: DuplicateProps2): React.ReactElement {
  return <div>{props.title}</div>;
}
