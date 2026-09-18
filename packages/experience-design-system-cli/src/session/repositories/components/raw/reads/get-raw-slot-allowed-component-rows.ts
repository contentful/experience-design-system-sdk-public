import type { DatabaseSync } from 'node:sqlite';
import { mapRawSlotAllowedComponentRow } from '../row-mappers.js';
import type { RawSlotAllowedComponentRow } from '../rows.js';

export function getRawSlotAllowedComponentRows(db: DatabaseSync, sessionId: string): RawSlotAllowedComponentRow[] {
  return db
    .prepare(
      `SELECT component_id, slot_name, position, allowed_component
       FROM raw_slot_allowed_components WHERE session_id = ? ORDER BY component_id, slot_name, position`,
    )
    .all(sessionId)
    .map(mapRawSlotAllowedComponentRow);
}
