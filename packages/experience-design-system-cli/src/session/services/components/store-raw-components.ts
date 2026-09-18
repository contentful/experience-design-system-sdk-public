import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../../types.js';
import { withTransaction } from '../../repositories/shared/with-transaction.js';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import {
  getRawPropAllowedValues,
  getClassifiedProps,
  getComponentDescriptions,
  getRawPropNameAtPosition,
} from '../../repositories/components/raw/read.js';
import {
  createRawComponent,
  createRawPropAllowedValue,
  createRawProps,
  createRawSlots,
  deleteRawComponentsForSession,
  deleteRawPropAllowedValuesForProp,
  updateRawComponentDescription,
  updateRawComponentsStatus,
  updateRawPropCdfByName,
  updateRawPropCdfByPosition,
} from '../../repositories/components/raw/write.js';
import { planCdfRestore } from '../../core/components/plan-cdf-restore.js';

export function storeRawComponents(
  db: DatabaseSync,
  sessionId: string,
  components: RawComponentDefinition[],
  options?: { status?: string; preserveCDF?: boolean },
): void {
  const now = new Date().toISOString();

  withTransaction(db, () => {
    const cdfSnapshot = options?.preserveCDF ? getClassifiedProps(db, sessionId) : [];
    const descSnapshot = options?.preserveCDF ? getComponentDescriptions(db, sessionId) : [];
    const avSnapshot = options?.preserveCDF && cdfSnapshot.length > 0 ? getRawPropAllowedValues(db, sessionId) : [];

    deleteRawComponentsForSession(db, sessionId);

    for (const comp of components) {
      const componentId = createRawComponent(db, sessionId, comp, now);
      createRawProps(db, sessionId, componentId, comp.props);
      createRawSlots(db, sessionId, componentId, comp.slots);
    }

    if (options?.preserveCDF && cdfSnapshot.length > 0) {
      const currentPropNameCache = new Map<string, string | null>();
      const plan = planCdfRestore(cdfSnapshot, descSnapshot, avSnapshot, {
        hasPropNamed: (componentId, propName) => hasPropByName(db, sessionId, componentId, propName),
        propNameAtPosition: (componentId, position) => {
          const key = `${componentId}::${position}`;
          if (currentPropNameCache.has(key)) return currentPropNameCache.get(key)!;
          const name = getRawPropNameAtPosition(db, sessionId, componentId, position);
          currentPropNameCache.set(key, name);
          return name;
        },
      });

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
      for (const [key, avs] of plan.allowedValuesByPropKey) {
        const [componentId, propName] = key.split('::');
        if (!componentId || !propName) continue;
        deleteRawPropAllowedValuesForProp(db, sessionId, componentId, propName);
        for (const av of avs) {
          createRawPropAllowedValue(db, sessionId, componentId, propName, av.position, av.value);
        }
      }
    }

    if (options?.status) {
      updateRawComponentsStatus(db, sessionId, options.status);
    }
    updateSessionTimestamp(db, sessionId, now);
  });
}

function hasPropByName(db: DatabaseSync, sessionId: string, componentId: string, propName: string): boolean {
  const row = db
    .prepare('SELECT 1 as one FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?')
    .get(sessionId, componentId, propName);
  return row !== undefined;
}
