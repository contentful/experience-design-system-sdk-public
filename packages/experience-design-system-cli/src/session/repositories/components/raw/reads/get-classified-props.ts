import type { DatabaseSync } from 'node:sqlite';
import type { CdfSnapshotEntry } from '../../../../core/components/plan-cdf-restore.js';

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
