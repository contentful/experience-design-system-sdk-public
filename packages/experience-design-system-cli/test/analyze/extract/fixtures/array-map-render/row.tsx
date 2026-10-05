import type { ReactNode } from 'react';

export type RowProps = {
  children?: ReactNode;
};

export function Row({ children }: RowProps) {
  return <div>{children}</div>;
}
