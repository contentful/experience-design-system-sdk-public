import type { ReactElement } from 'react';
import type { NodeAProps } from './NodeA.js';

export interface NodeBProps {
  slot: ReactElement<NodeAProps>;
}

export function NodeB({ slot }: NodeBProps): ReactElement {
  return <div data-node="B">{slot}</div>;
}
