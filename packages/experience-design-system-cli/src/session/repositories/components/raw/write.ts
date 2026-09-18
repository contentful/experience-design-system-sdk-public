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
  for (let i = 0; i < props.length; i++) {
    const prop = props[i]!;
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
      i,
      prop.sourceStartLine ?? null,
      prop.sourceEndLine ?? null,
    );
    if (prop.allowedValues) {
      prop.allowedValues.forEach((v, j) => insertAllowedValue.run(sessionId, componentId, prop.name, j, v));
    }
  }
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
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    insertSlot.run(sessionId, componentId, slot.name, slot.isDefault ? 1 : 0, slot.description ?? null, i);
    if (slot.allowedComponents) {
      slot.allowedComponents.forEach((ac, j) => insertAllowedComponent.run(sessionId, componentId, slot.name, j, ac));
    }
  }
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

export function updateRawPropCdfClassification(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  cdfType: string,
  cdfCategory: string,
  cdfTokenKind: string | null,
  required: boolean,
  description: string | null,
  rationale: string | null,
): number {
  const result = db
    .prepare(
      `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ?, description = ?, rationale = ?
       WHERE session_id = ? AND component_id = ? AND name = ?`,
    )
    .run(
      cdfType,
      cdfCategory,
      cdfTokenKind,
      required ? 1 : 0,
      description,
      rationale,
      sessionId,
      componentId,
      propName,
    );
  return Number(result.changes);
}

export function updateRawPropAsExcluded(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  rationale: string | null,
): void {
  db.prepare(
    `UPDATE raw_props
     SET cdf_type = CASE WHEN type = 'boolean' THEN 'boolean' ELSE 'string' END,
         cdf_category = 'unattached',
         cdf_token_kind = NULL,
         required = 0,
         rationale = ?
     WHERE session_id = ? AND component_id = ? AND name = ?`,
  ).run(rationale, sessionId, componentId, propName);
}

export function updateRawPropDefaultValue(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  defaultValue: string,
): void {
  db.prepare(`UPDATE raw_props SET default_value = ? WHERE session_id = ? AND component_id = ? AND name = ?`).run(
    defaultValue,
    sessionId,
    componentId,
    propName,
  );
}

export function deleteRawPropTokenPathsForProp(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
): void {
  db.prepare(`DELETE FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ? AND prop_name = ?`).run(
    sessionId,
    componentId,
    propName,
  );
}

export function updateRawComponentRationales(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  rationales: { description?: string; props?: string; slots?: string },
): void {
  if (rationales.description !== undefined) {
    db.prepare(
      'UPDATE raw_components SET component_description_rationale = ? WHERE session_id = ? AND component_id = ?',
    ).run(rationales.description, sessionId, componentId);
  }
  if (rationales.props !== undefined) {
    db.prepare('UPDATE raw_components SET props_rationale = ? WHERE session_id = ? AND component_id = ?').run(
      rationales.props,
      sessionId,
      componentId,
    );
  }
  if (rationales.slots !== undefined) {
    db.prepare('UPDATE raw_components SET slots_rationale = ? WHERE session_id = ? AND component_id = ?').run(
      rationales.slots,
      sessionId,
      componentId,
    );
  }
}

export function updateRawComponentAsGenerated(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  extractedAt: string,
): void {
  db.prepare(
    `UPDATE raw_components SET status = 'generated', extracted_at = ? WHERE session_id = ? AND component_id = ?`,
  ).run(extractedAt, sessionId, componentId);
}

export function updateRawSlotClassification(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slotName: string,
  required: boolean,
  description: string | null,
): number {
  const result = db
    .prepare(
      `UPDATE raw_slots SET required = ?, description = ? WHERE session_id = ? AND component_id = ? AND name = ?`,
    )
    .run(required ? 1 : 0, description, sessionId, componentId, slotName);
  return Number(result.changes);
}

export function updateRawSlotRationale(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slotName: string,
  rationale: string,
): void {
  db.prepare('UPDATE raw_slots SET rationale = ? WHERE session_id = ? AND component_id = ? AND name = ?').run(
    rationale,
    sessionId,
    componentId,
    slotName,
  );
}

export function deleteRawSlotAllowedComponentsForSlot(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slotName: string,
): void {
  db.prepare(`DELETE FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ? AND slot_name = ?`).run(
    sessionId,
    componentId,
    slotName,
  );
}

export function createRawSlotAllowedComponent(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slotName: string,
  position: number,
  allowedComponent: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO raw_slot_allowed_components (session_id, component_id, slot_name, allowed_component, position)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, componentId, slotName, allowedComponent, position);
}
