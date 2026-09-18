import type { DatabaseSync } from 'node:sqlite';
import { mapRawComponentRow } from '../row-mappers.js';
import type { RawComponentRow } from '../rows.js';

export function getRawComponentRows(db: DatabaseSync, sessionId: string): RawComponentRow[] {
  return db
    .prepare(
      'SELECT component_id, name, source, framework, extraction_confidence, review_reasons, needs_review, source_path FROM raw_components WHERE session_id = ? ORDER BY rowid',
    )
    .all(sessionId)
    .map(mapRawComponentRow);
}
