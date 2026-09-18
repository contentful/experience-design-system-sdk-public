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
