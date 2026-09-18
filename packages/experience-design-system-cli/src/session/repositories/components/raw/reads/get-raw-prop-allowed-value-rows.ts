import type { DatabaseSync } from 'node:sqlite';
import { mapAllowedValueSnapshotRow } from '../row-mappers.js';
import type { AllowedValueSnapshotEntry } from '../../../../core/components/plan-cdf-restore.js';

// Ordered variant used when composing full RawComponentWithId payloads —
// ordering ensures position sequence in the reassembled prop.allowedValues.
export function getRawPropAllowedValueRows(db: DatabaseSync, sessionId: string): AllowedValueSnapshotEntry[] {
  return db
    .prepare(
      `SELECT component_id, prop_name, position, value
       FROM raw_prop_allowed_values WHERE session_id = ? ORDER BY component_id, prop_name, position`,
    )
    .all(sessionId)
    .map(mapAllowedValueSnapshotRow);
}
