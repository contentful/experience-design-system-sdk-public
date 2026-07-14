import * as React from 'react';

export interface ValidProps {
  text: string;
}

export function Valid(props: ValidProps): React.ReactElement {
  return <p>{props.text}</p>;
}
