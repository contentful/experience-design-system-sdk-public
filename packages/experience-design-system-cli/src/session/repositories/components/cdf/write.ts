import type { DatabaseSync } from 'node:sqlite';

export function updateCdfComponentDescription(
  db: DatabaseSync,
  sessionId: string,
  componentName: string,
  description: string | null,
): void {
  db.prepare(`UPDATE raw_components SET status = 'generated', description = ? WHERE session_id = ? AND name = ?`).run(
    description,
    sessionId,
    componentName,
  );
}

export function updateCdfPropClassification(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  cdfType: string,
  cdfCategory: string,
  cdfTokenKind: string | null,
  required: boolean,
): void {
  db.prepare(
    `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ?
     WHERE session_id = ? AND component_id = ? AND name = ?`,
  ).run(cdfType, cdfCategory, cdfTokenKind, required ? 1 : 0, sessionId, componentId, propName);
}

export function deleteRawSlotsForComponent(db: DatabaseSync, sessionId: string, componentId: string): void {
  db.prepare('DELETE FROM raw_slots WHERE session_id = ? AND component_id = ?').run(sessionId, componentId);
}

export function deleteRawSlotAllowedComponentsForComponent(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
): void {
  db.prepare('DELETE FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ?').run(
    sessionId,
    componentId,
  );
}

export function createRawSlotForCdf(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slotName: string,
  isDefault: number,
  required: boolean,
  description: string | null,
  position: number,
): void {
  db.prepare(
    `INSERT INTO raw_slots (session_id, component_id, name, is_default, required, description, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, componentId, slotName, isDefault, required ? 1 : 0, description, position);
}

export function upsertRawSlotForCdf(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slotName: string,
  required: boolean,
  description: string | null,
  position: number,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO raw_slots
       (session_id, component_id, name, is_default, required, description, position)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run(sessionId, componentId, slotName, required ? 1 : 0, description, position);
}

export function createMinimalRawComponent(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  name: string,
  extractedAt: string,
  description: string | null,
): void {
  db.prepare(
    `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, status, description)
     VALUES (?, ?, ?, '', 'react', ?, 'generated', ?)`,
  ).run(sessionId, componentId, name, extractedAt, description);
}

export function upsertMinimalRawProp(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  required: boolean,
  position: number,
  cdfType: string,
  cdfCategory: string,
  cdfTokenKind: string | null,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO raw_props
       (session_id, component_id, name, type, required, category, default_value, description, token_reference, position, cdf_type, cdf_category, cdf_token_kind)
     VALUES (?, ?, ?, '', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
  ).run(sessionId, componentId, propName, required ? 1 : 0, position, cdfType, cdfCategory, cdfTokenKind);
}

export function createRawPropAllowedValueOrdered(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  value: string,
  position: number,
): void {
  db.prepare(
    `INSERT INTO raw_prop_allowed_values (session_id, component_id, prop_name, value, position)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, componentId, propName, value, position);
}

export function createRawSlotAllowedComponentOrdered(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  slotName: string,
  allowedComponent: string,
  position: number,
): void {
  db.prepare(
    `INSERT INTO raw_slot_allowed_components (session_id, component_id, slot_name, allowed_component, position)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, componentId, slotName, allowedComponent, position);
}

export function createRawPropTokenPath(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  source: 'agent' | 'review',
  position: number,
  path: string,
): void {
  db.prepare(
    `INSERT INTO raw_prop_token_paths (session_id, component_id, prop_name, source, position, path)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, componentId, propName, source, position, path);
}

export function updateRawComponentsStatusForNames(
  db: DatabaseSync,
  sessionId: string,
  names: string[],
  status: string,
): void {
  if (names.length === 0) return;
  const placeholders = names.map(() => '?').join(',');
  db.prepare(`UPDATE raw_components SET status = ? WHERE session_id = ? AND name IN (${placeholders})`).run(
    status,
    sessionId,
    ...names,
  );
}

export function updateRawSlotName(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  oldName: string,
  position: number,
  newName: string,
): void {
  db.prepare(
    `UPDATE raw_slots SET name = ? WHERE session_id = ? AND component_id = ? AND name = ? AND position = ?`,
  ).run(newName, sessionId, componentId, oldName, position);
}

export function getEmptyRawSlots(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
): Array<{ name: string; position: number }> {
  return db
    .prepare(
      `SELECT name, position FROM raw_slots
       WHERE session_id = ? AND component_id = ? AND trim(name) = ''
       ORDER BY position`,
    )
    .all(sessionId, componentId)
    .map((row) => ({ name: String(row.name), position: Number(row.position) }));
}
