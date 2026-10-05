import { Cell } from './cell.js';

export type CellEntry = {
  label: string;
};

export type NegTableProps = {
  cells: CellEntry[];
};

// Negative case: Cell is rendered inside the map AND as a standalone header
// outside the map. Standalone use means Cell is an implementation detail of
// NegTable, not an authorable slot child. The signal must NOT fire.
export function NegTable({ cells }: NegTableProps) {
  return (
    <div>
      <Cell label="Header" />
      {cells.map((cell, index) => (
        <Cell key={index} label={cell.label} />
      ))}
    </div>
  );
}
