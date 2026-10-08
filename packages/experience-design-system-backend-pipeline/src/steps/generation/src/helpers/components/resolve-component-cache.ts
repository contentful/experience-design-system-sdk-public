import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import {
  findUnknownSlotAllowedComponents,
  lookupCacheByEntity,
  type CacheEntry,
} from '../../../../../persistence/src/session/repositories/db.js';
import { lookupComponentCache } from './lookup-component-cache.js';

export type ComponentCacheResolution = {
  entry: CacheEntry;
  humanEdited: boolean;
};

/**
 * One shared precedence rule for picking a reusable component definition:
 * hash-matched cache entry first; a human-edited pinned entry wins only when
 * no hash-match exists and all referenced slot targets still resolve.
 */
export function resolveComponentCache(
  db: DatabaseSync,
  component: RawComponentDefinition & { component_id: string },
  promptHash: string,
  allowedComponentNames: ReadonlySet<string>,
): ComponentCacheResolution | null {
  const cached = lookupComponentCache(db, component, promptHash);
  if (
    cached &&
    findUnknownSlotAllowedComponents(db, cached.sourceSessionId, allowedComponentNames, component.component_id)
      .length === 0
  ) {
    return { entry: cached, humanEdited: cached.humanEdited };
  }

  const pinned = lookupCacheByEntity(db, 'component', component.component_id);
  if (
    pinned?.humanEdited &&
    findUnknownSlotAllowedComponents(db, pinned.sourceSessionId, allowedComponentNames, component.component_id)
      .length === 0
  ) {
    return { entry: pinned, humanEdited: true };
  }
  return null;
}
