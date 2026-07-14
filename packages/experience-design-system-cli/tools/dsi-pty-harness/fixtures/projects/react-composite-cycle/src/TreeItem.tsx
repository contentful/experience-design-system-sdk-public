import type { ReactElement } from 'react';
import type { TreeGroupProps } from './TreeGroup.js';

export interface TreeItemProps {
  group: ReactElement<TreeGroupProps>;
}

export function TreeItem({ group }: TreeItemProps): ReactElement {
  return <li>{group}</li>;
}
