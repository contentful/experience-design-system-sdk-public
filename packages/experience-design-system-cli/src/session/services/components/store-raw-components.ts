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
  createRawProps,
  createRawSlots,
  deleteRawComponentsForSession,
  updateRawComponentsStatus,
} from '../../repositories/components/raw/write.js';
import { planCdfRestore } from '../../core/components/plan-cdf-restore.js';
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
        hasPropNamed: (componentId, propName) => hasPropByName(db, sessionId, componentId, propName),
        propNameAtPosition: memoize((componentId, position) =>
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

function hasPropByName(db: DatabaseSync, sessionId: string, componentId: string, propName: string): boolean {
  const row = db
    .prepare('SELECT 1 as one FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?')
    .get(sessionId, componentId, propName);
  return row !== undefined;
}

function memoize(
  lookup: (componentId: string, position: number) => string | null,
): (componentId: string, position: number) => string | null {
  const cache = new Map<string, string | null>();
  return (componentId, position) => {
    const key = `${componentId}::${position}`;
    if (cache.has(key)) return cache.get(key)!;
    const value = lookup(componentId, position);
    cache.set(key, value);
    return value;
  };
}
