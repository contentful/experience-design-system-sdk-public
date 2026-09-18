import type { DatabaseSync } from 'node:sqlite';
import type { CdfRestorePlan } from '../../core/components/plan-cdf-restore.js';
import {
  createRawPropAllowedValue,
  deleteRawPropAllowedValuesForProp,
  updateRawComponentDescription,
  updateRawPropCdfByName,
  updateRawPropCdfByPosition,
} from '../../repositories/components/raw/write.js';

// Applies a CdfRestorePlan produced by planCdfRestore() by dispatching each
// bucket to the appropriate repo write. Callers must invoke this inside an
// active transaction — see store-raw-components for the invariant.
export function applyCdfRestore(db: DatabaseSync, sessionId: string, plan: CdfRestorePlan): void {
  for (const snap of plan.byName) {
    updateRawPropCdfByName(
      db,
      sessionId,
      snap.component_id,
      snap.name,
      snap.cdf_type,
      snap.cdf_category,
      snap.cdf_token_kind,
    );
  }
  for (const snap of plan.byPosition) {
    updateRawPropCdfByPosition(
      db,
      sessionId,
      snap.component_id,
      snap.position,
      snap.cdf_type,
      snap.cdf_category,
      snap.cdf_token_kind,
    );
  }
  for (const snap of plan.descriptions) {
    updateRawComponentDescription(db, sessionId, snap.component_id, snap.description);
  }
  for (const bucket of plan.allowedValues) {
    deleteRawPropAllowedValuesForProp(db, sessionId, bucket.componentId, bucket.propName);
    for (const av of bucket.values) {
      createRawPropAllowedValue(db, sessionId, bucket.componentId, bucket.propName, av.position, av.value);
    }
  }
}
