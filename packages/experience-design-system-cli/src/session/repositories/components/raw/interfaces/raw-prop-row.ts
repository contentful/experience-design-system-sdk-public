export interface RawPropRow {
  component_id: string;
  name: string;
  type: string;
  required: number;
  category: string | null;
  default_value: string | null;
  description: string | null;
  token_reference: string | null;
  position: number;
  rationale: string | null;
  source_start_line: number | null;
  source_end_line: number | null;
}
