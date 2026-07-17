import type { ReactElement } from 'react';
import type { TreeListProps } from './TreeList.js';

export interface TreeGroupProps {
  list: ReactElement<TreeListProps>;
}

export function TreeGroup({ list }: TreeGroupProps): ReactElement {
  return <div>{list}</div>;
}
