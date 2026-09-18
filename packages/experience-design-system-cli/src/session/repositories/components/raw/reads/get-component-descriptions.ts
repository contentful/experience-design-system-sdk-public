import type { DatabaseSync } from 'node:sqlite';
import type { DescriptionSnapshotEntry } from '../../../../core/components/plan-cdf-restore.js';

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
