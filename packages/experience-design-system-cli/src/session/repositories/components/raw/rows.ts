export interface RawComponentRow {
  component_id: string;
  name: string;
  source: string;
  framework: string;
  extraction_confidence: number | null;
  review_reasons: string;
  needs_review: number;
  source_path: string | null;
}

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

export interface RawSlotRow {
  component_id: string;
  name: string;
  is_default: number;
  description: string | null;
  position: number;
}

export interface RawSlotAllowedComponentRow {
  component_id: string;
  slot_name: string;
  position: number;
  allowed_component: string;
}
