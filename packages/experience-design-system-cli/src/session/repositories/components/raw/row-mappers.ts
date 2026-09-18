import type { AllowedValueSnapshotEntry } from '../../../core/components/plan-cdf-restore.js';
import type { RawComponentRow, RawPropRow, RawSlotAllowedComponentRow, RawSlotRow } from './rows.js';

export function mapRawComponentRow(row: Record<string, unknown>): RawComponentRow {
  return {
    component_id: String(row.component_id),
    name: String(row.name),
    source: String(row.source),
    framework: String(row.framework),
    extraction_confidence: row.extraction_confidence === null ? null : Number(row.extraction_confidence),
    review_reasons: String(row.review_reasons ?? '[]'),
    needs_review: Number(row.needs_review ?? 0),
    source_path: row.source_path === null ? null : String(row.source_path),
  };
}

export function mapRawPropRow(row: Record<string, unknown>): RawPropRow {
  return {
    component_id: String(row.component_id),
    name: String(row.name),
    type: String(row.type),
    required: Number(row.required),
    category: row.category === null ? null : String(row.category),
    default_value: row.default_value === null ? null : String(row.default_value),
    description: row.description === null ? null : String(row.description),
    token_reference: row.token_reference === null ? null : String(row.token_reference),
    position: Number(row.position),
    rationale: row.rationale === null ? null : String(row.rationale),
    source_start_line: row.source_start_line === null ? null : Number(row.source_start_line),
    source_end_line: row.source_end_line === null ? null : Number(row.source_end_line),
  };
}

export function mapAllowedValueSnapshotRow(row: Record<string, unknown>): AllowedValueSnapshotEntry {
  return {
    component_id: String(row.component_id),
    prop_name: String(row.prop_name),
    position: Number(row.position),
    value: String(row.value),
  };
}

export function mapRawSlotRow(row: Record<string, unknown>): RawSlotRow {
  return {
    component_id: String(row.component_id),
    name: String(row.name),
    is_default: Number(row.is_default),
    description: row.description === null ? null : String(row.description),
    position: Number(row.position),
  };
}

export function mapRawSlotAllowedComponentRow(row: Record<string, unknown>): RawSlotAllowedComponentRow {
  return {
    component_id: String(row.component_id),
    slot_name: String(row.slot_name),
    position: Number(row.position),
    allowed_component: String(row.allowed_component),
  };
}

export function parseReviewReasons(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
