import type { DatabaseSync } from 'node:sqlite';
import { mapAllowedValueSnapshotRow } from '../row-mappers.js';
import type { AllowedValueSnapshotEntry } from '../../../../core/components/plan-cdf-restore.js';

// Unordered full-session read used by callers that don't need positional
// ordering (e.g. the CDF-restore snapshot pass in storeRawComponents). See
// getRawPropAllowedValueRows for the ordered composer variant.
export function getRawPropAllowedValues(db: DatabaseSync, sessionId: string): AllowedValueSnapshotEntry[] {
  return db
    .prepare(`SELECT component_id, prop_name, position, value FROM raw_prop_allowed_values WHERE session_id = ?`)
    .all(sessionId)
    .map(mapAllowedValueSnapshotRow);
}
