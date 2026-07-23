import type { ReactElement } from 'react';

export interface CalloutProps {
  message: string;
}

export function Callout({ message }: CalloutProps): ReactElement {
  return <aside>{message}</aside>;
}
