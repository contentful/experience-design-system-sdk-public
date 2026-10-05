import type { ReactNode } from 'react';
import { Row } from './row.js';

export type NegListProps = {
  entries: ReactNode[];
};

// Negative case: entries is ReactNode[], which is a JSX-carrying type. The
// typed-slot pass handles this shape; the array-map signal must NOT fire.
export function NegList({ entries }: NegListProps) {
  return (
    <div>
      {entries.map((entry, index) => (
        <Row key={index}>{entry}</Row>
      ))}
    </div>
  );
}
