import type { DatabaseSync } from 'node:sqlite';
import { mapRawSlotRow } from '../row-mappers.js';
import type { RawSlotRow } from '../rows.js';

export function getRawSlotRows(db: DatabaseSync, sessionId: string): RawSlotRow[] {
  return db
    .prepare(
      `SELECT component_id, name, is_default, description, position
       FROM raw_slots WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId)
    .map(mapRawSlotRow);
}
