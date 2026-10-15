import type { DatabaseSync } from 'node:sqlite';
import {
  filterUnknownSlotAllowedComponents,
  loadRawComponents,
  type RawComponentWithId,
} from '../../../persistence/src/session/repositories/db.js';

export interface FilterDroppedAllowedComponentsResult {
  components: RawComponentWithId[];
  dropped: Array<{ componentName: string; slotName: string; allowedComponent: string }>;
}

export function filterDroppedAllowedComponents(
  db: DatabaseSync,
  sessionId: string,
  components: RawComponentWithId[],
  allowedComponentNames: ReadonlySet<string>,
  acceptedNames: Set<string> | undefined,
): FilterDroppedAllowedComponentsResult {
  const dropped = filterUnknownSlotAllowedComponents(db, sessionId, allowedComponentNames);
  if (dropped.length === 0) return { components, dropped: [] };
  return { components: loadRawComponents(db, sessionId, acceptedNames), dropped };
}
