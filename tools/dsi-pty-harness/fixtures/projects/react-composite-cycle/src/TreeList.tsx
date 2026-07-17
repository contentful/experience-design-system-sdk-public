import type { ReactElement } from 'react';
import type { TreeItemProps } from './TreeItem.js';

export interface TreeListProps {
  items: ReactElement<TreeItemProps>[];
}

export function TreeList({ items }: TreeListProps): ReactElement {
  return <ul>{items}</ul>;
}
