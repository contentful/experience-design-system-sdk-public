import type { ReactElement } from 'react';
import type { NodeBProps } from './NodeB.js';

export interface NodeAProps {
  slot: ReactElement<NodeBProps>;
}

export function NodeA({ slot }: NodeAProps): ReactElement {
  return <div data-node="A">{slot}</div>;
}
