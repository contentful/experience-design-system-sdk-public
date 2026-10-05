export type CellProps = {
  label: string;
};

export function Cell({ label }: CellProps) {
  return <span>{label}</span>;
}
