import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../../types.js';
import { indexRowsByKey } from '../../../core/shared/index-rows-by-key.js';
import type {
  AllowedValueSnapshotEntry,
  CdfSnapshotEntry,
  DescriptionSnapshotEntry,
} from '../../../core/components/plan-cdf-restore.js';

export type RawComponentWithId = RawComponentDefinition & {
  component_id: string;
};

interface RawComponentRow {
  component_id: string;
  name: string;
  source: string;
  framework: string;
  extraction_confidence: number | null;
  review_reasons: string;
  needs_review: number;
  source_path: string | null;
}

interface RawPropRow {
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

interface RawSlotRow {
  component_id: string;
  name: string;
  is_default: number;
  description: string | null;
  position: number;
}

interface RawSlotAllowedComponentRow {
  component_id: string;
  slot_name: string;
  position: number;
  allowed_component: string;
}

function mapRawComponentRow(row: Record<string, unknown>): RawComponentRow {
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

function mapRawPropRow(row: Record<string, unknown>): RawPropRow {
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

function mapAllowedValueSnapshotRow(row: Record<string, unknown>): AllowedValueSnapshotEntry {
  return {
    component_id: String(row.component_id),
    prop_name: String(row.prop_name),
    position: Number(row.position),
    value: String(row.value),
  };
}

function mapRawSlotRow(row: Record<string, unknown>): RawSlotRow {
  return {
    component_id: String(row.component_id),
    name: String(row.name),
    is_default: Number(row.is_default),
    description: row.description === null ? null : String(row.description),
    position: Number(row.position),
  };
}

function mapRawSlotAllowedComponentRow(row: Record<string, unknown>): RawSlotAllowedComponentRow {
  return {
    component_id: String(row.component_id),
    slot_name: String(row.slot_name),
    position: Number(row.position),
    allowed_component: String(row.allowed_component),
  };
}

function parseReviewReasons(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function getRawComponents(
  db: DatabaseSync,
  sessionId: string,
  allowedNames?: Set<string>,
): RawComponentWithId[] {
  const all = db
    .prepare(
      'SELECT component_id, name, source, framework, extraction_confidence, review_reasons, needs_review, source_path FROM raw_components WHERE session_id = ? ORDER BY rowid',
    )
    .all(sessionId)
    .map(mapRawComponentRow);

  const components = allowedNames ? all.filter((c) => allowedNames.has(c.name)) : all;
  if (components.length === 0) return [];

  const props = db
    .prepare(
      `SELECT component_id, name, type, required, category, default_value, description, token_reference, position,
              rationale, source_start_line, source_end_line
       FROM raw_props WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId)
    .map(mapRawPropRow);

  const allowedValues = db
    .prepare(
      `SELECT component_id, prop_name, position, value
       FROM raw_prop_allowed_values WHERE session_id = ? ORDER BY component_id, prop_name, position`,
    )
    .all(sessionId)
    .map(mapAllowedValueSnapshotRow);

  const slots = db
    .prepare(
      `SELECT component_id, name, is_default, description, position
       FROM raw_slots WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId)
    .map(mapRawSlotRow);

  const allowedComponents = db
    .prepare(
      `SELECT component_id, slot_name, position, allowed_component
       FROM raw_slot_allowed_components WHERE session_id = ? ORDER BY component_id, slot_name, position`,
    )
    .all(sessionId)
    .map(mapRawSlotAllowedComponentRow);

  const propsByComponent = indexRowsByKey(props, (p) => p.component_id);
  const allowedValuesByProp = indexRowsByKey(allowedValues, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = indexRowsByKey(slots, (s) => s.component_id);
  const allowedComponentsBySlot = indexRowsByKey(allowedComponents, (ac) => `${ac.component_id}::${ac.slot_name}`);

  return components.map(
    (c): RawComponentWithId => ({
      component_id: c.component_id,
      name: c.name,
      source: c.source,
      framework: c.framework as RawComponentDefinition['framework'],
      extractionConfidence: c.extraction_confidence ?? null,
      reviewReasons: parseReviewReasons(c.review_reasons),
      needsReview: Boolean(c.needs_review),
      sourcePath: c.source_path ?? undefined,
      props: (propsByComponent.get(c.component_id) ?? []).map((p): RawPropDefinition => {
        const av = allowedValuesByProp.get(`${c.component_id}::${p.name}`);
        const prop: RawPropDefinition = {
          name: p.name,
          type: p.type,
          required: Boolean(p.required),
        };
        if (p.category !== null) prop.category = p.category as RawPropDefinition['category'];
        if (p.default_value !== null) prop.defaultValue = p.default_value;
        if (p.description !== null) prop.description = p.description;
        if (p.token_reference !== null) prop.tokenReference = p.token_reference;
        if (av && av.length > 0) prop.allowedValues = av.map((v) => v.value);
        if (p.source_start_line !== null) prop.sourceStartLine = p.source_start_line;
        if (p.source_end_line !== null) prop.sourceEndLine = p.source_end_line;
        return prop;
      }),
      slots: (slotsByComponent.get(c.component_id) ?? []).map((s): RawSlotDefinition => {
        const ac = allowedComponentsBySlot.get(`${c.component_id}::${s.name}`);
        const slot: RawSlotDefinition = {
          name: s.name,
          isDefault: Boolean(s.is_default),
        };
        if (s.description !== null) slot.description = s.description;
        if (ac && ac.length > 0) slot.allowedComponents = ac.map((v) => v.allowed_component);
        return slot;
      }),
    }),
  );
}

export function getClassifiedProps(db: DatabaseSync, sessionId: string): CdfSnapshotEntry[] {
  return db
    .prepare(
      `SELECT component_id, name, position, cdf_type, cdf_category, cdf_token_kind
       FROM raw_props WHERE session_id = ? AND cdf_type IS NOT NULL`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      name: String(row.name),
      position: Number(row.position),
      cdf_type: String(row.cdf_type),
      cdf_category: String(row.cdf_category),
      cdf_token_kind: row.cdf_token_kind === null ? null : String(row.cdf_token_kind),
    }));
}

export function getComponentDescriptions(db: DatabaseSync, sessionId: string): DescriptionSnapshotEntry[] {
  return db
    .prepare(
      `SELECT component_id, description
       FROM raw_components WHERE session_id = ? AND description IS NOT NULL`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      description: String(row.description),
    }));
}

export function getRawPropAllowedValues(db: DatabaseSync, sessionId: string): AllowedValueSnapshotEntry[] {
  return db
    .prepare(`SELECT component_id, prop_name, position, value FROM raw_prop_allowed_values WHERE session_id = ?`)
    .all(sessionId)
    .map(mapAllowedValueSnapshotRow);
}

export function getRawPropNameAtPosition(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  position: number,
): string | null {
  const row = db
    .prepare(`SELECT name FROM raw_props WHERE session_id = ? AND component_id = ? AND position = ?`)
    .get(sessionId, componentId, position);
  return row ? String(row.name) : null;
}
