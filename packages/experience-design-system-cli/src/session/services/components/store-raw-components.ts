import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../../types.js';
import { withTransaction } from '../../repositories/shared/with-transaction.js';
import { updateSessionTimestamp } from '../../repositories/sessions/write.js';
import {
  getClassifiedProps,
  getComponentDescriptions,
  getRawPropAllowedValues,
  getRawPropNameAtPosition,
  hasRawPropNamed,
} from '../../repositories/components/raw/read.js';
import {
  createRawComponent,
  createRawProps,
  createRawSlots,
  deleteRawComponentsForSession,
  updateRawComponentsStatus,
} from '../../repositories/components/raw/write.js';
import { planCdfRestore } from '../../core/components/plan-cdf-restore.js';
import { memoizeByKey } from '../../core/shared/memoize-by-key.js';
import { applyCdfRestore } from './apply-cdf-restore.js';

// Snapshot → mutate → restore, all inside one transaction. planCdfRestore
// runs AFTER the mutation and queries the just-inserted rows. This only works
// because SQLite reads on the same connection see the pending writes of the
// enclosing transaction — do not split this flow across transactions or
// connections.
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
      const plan = planCdfRestore(cdfSnapshot, descSnapshot, avSnapshot, {
        hasPropNamed: (componentId, propName) => hasRawPropNamed(db, sessionId, componentId, propName),
        propNameAtPosition: memoizeByKey((componentId: string, position: number) =>
          getRawPropNameAtPosition(db, sessionId, componentId, position),
        ),
      });
      applyCdfRestore(db, sessionId, plan);
    }

    if (options?.status) {
      updateRawComponentsStatus(db, sessionId, options.status);
    }
    updateSessionTimestamp(db, sessionId, now);
  });
}
