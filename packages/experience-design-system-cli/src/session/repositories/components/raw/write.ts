import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../../../types.js';
import { deriveComponentId } from '../../../core/components/derive-component-id.js';

export function deleteRawComponentsForSession(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM raw_components WHERE session_id = ?').run(sessionId);
}

export function createRawComponent(
  db: DatabaseSync,
  sessionId: string,
  comp: RawComponentDefinition,
  extractedAt: string,
): string {
  const componentId = deriveComponentId(comp.name, comp.source);
  db.prepare(
    `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, extraction_confidence, review_reasons, needs_review, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    componentId,
    comp.name,
    comp.source,
    comp.framework,
    extractedAt,
    comp.extractionConfidence ?? null,
    JSON.stringify(comp.reviewReasons ?? []),
    comp.needsReview ? 1 : 0,
    comp.sourcePath ?? null,
  );
  return componentId;
}

export function createRawProps(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  props: RawComponentDefinition['props'],
): void {
  const insertProp = db.prepare(
    `INSERT INTO raw_props
       (session_id, component_id, name, type, required, category, default_value, description, token_reference, position, source_start_line, source_end_line)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAllowedValue = db.prepare(
    `INSERT INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value)
     VALUES (?, ?, ?, ?, ?)`,
  );
  props.forEach((prop, position) => {
    insertPropRow(insertProp, sessionId, componentId, prop, position);
    insertPropAllowedValues(insertAllowedValue, sessionId, componentId, prop);
  });
}

function insertPropRow(
  insertProp: ReturnType<DatabaseSync['prepare']>,
  sessionId: string,
  componentId: string,
  prop: RawComponentDefinition['props'][number],
  position: number,
): void {
  insertProp.run(
    sessionId,
    componentId,
    prop.name,
    prop.type,
    prop.required ? 1 : 0,
    prop.category ?? null,
    prop.defaultValue ?? null,
    prop.description ?? null,
    prop.tokenReference ?? null,
    position,
    prop.sourceStartLine ?? null,
    prop.sourceEndLine ?? null,
  );
}

function insertPropAllowedValues(
  insertAllowedValue: ReturnType<DatabaseSync['prepare']>,
  sessionId: string,
  componentId: string,
  prop: RawComponentDefinition['props'][number],
): void {
  if (!prop.allowedValues) return;
  prop.allowedValues.forEach((value, position) => {
    insertAllowedValue.run(sessionId, componentId, prop.name, position, value);
  });
}

export function createRawSlots(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slots: RawComponentDefinition['slots'],
): void {
  const insertSlot = db.prepare(
    `INSERT INTO raw_slots (session_id, component_id, name, is_default, description, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertAllowedComponent = db.prepare(
    `INSERT INTO raw_slot_allowed_components (session_id, component_id, slot_name, position, allowed_component)
     VALUES (?, ?, ?, ?, ?)`,
  );
  slots.forEach((slot, position) => {
    insertSlotRow(insertSlot, sessionId, componentId, slot, position);
    insertSlotAllowedComponents(insertAllowedComponent, sessionId, componentId, slot);
  });
}

function insertSlotRow(
  insertSlot: ReturnType<DatabaseSync['prepare']>,
  sessionId: string,
  componentId: string,
  slot: RawComponentDefinition['slots'][number],
  position: number,
): void {
  insertSlot.run(sessionId, componentId, slot.name, slot.isDefault ? 1 : 0, slot.description ?? null, position);
}

function insertSlotAllowedComponents(
  insertAllowedComponent: ReturnType<DatabaseSync['prepare']>,
  sessionId: string,
  componentId: string,
  slot: RawComponentDefinition['slots'][number],
): void {
  if (!slot.allowedComponents) return;
  slot.allowedComponents.forEach((allowedComponent, position) => {
    insertAllowedComponent.run(sessionId, componentId, slot.name, position, allowedComponent);
  });
}

export function updateRawComponentsStatus(db: DatabaseSync, sessionId: string, status: string): void {
  db.prepare('UPDATE raw_components SET status = ? WHERE session_id = ?').run(status, sessionId);
}

export function updateRawPropCdfByName(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  cdfType: string,
  cdfCategory: string,
  cdfTokenKind: string | null,
): number {
  const result = db
    .prepare(
      `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?
       WHERE session_id = ? AND component_id = ? AND name = ?`,
    )
    .run(cdfType, cdfCategory, cdfTokenKind, sessionId, componentId, propName);
  return Number(result.changes);
}

export function updateRawPropCdfByPosition(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  position: number,
  cdfType: string,
  cdfCategory: string,
  cdfTokenKind: string | null,
): number {
  const result = db
    .prepare(
      `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?
       WHERE session_id = ? AND component_id = ? AND position = ? AND cdf_type IS NULL`,
    )
    .run(cdfType, cdfCategory, cdfTokenKind, sessionId, componentId, position);
  return Number(result.changes);
}

export function updateRawComponentDescription(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  description: string,
): void {
  db.prepare('UPDATE raw_components SET description = ? WHERE session_id = ? AND component_id = ?').run(
    description,
    sessionId,
    componentId,
  );
}

export function deleteRawPropAllowedValuesForProp(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
): void {
  db.prepare('DELETE FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ?').run(
    sessionId,
    componentId,
    propName,
  );
}

export function createRawPropAllowedValue(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  position: number,
  value: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, componentId, propName, position, value);
}
