import type { DatabaseSync } from 'node:sqlite';
import { mapRawPropRow } from '../row-mappers.js';
import type { RawPropRow } from '../rows.js';

export function getRawPropRows(db: DatabaseSync, sessionId: string): RawPropRow[] {
  return db
    .prepare(
      `SELECT component_id, name, type, required, category, default_value, description, token_reference, position,
              rationale, source_start_line, source_end_line
       FROM raw_props WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId)
    .map(mapRawPropRow);
}
