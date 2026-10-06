import {
  computeComponentInputHash,
  lookupCache,
  lookupCacheByEntity,
  findUnknownSlotAllowedComponents,
} from '../../session/db.js';
import type { openPipelineDb } from '../../session/db.js';
import type { RawComponentDefinition } from '../../types.js';
import { normalizeComponentForCache } from '../helpers/normalize-component-for-cache.js';

export type ComponentCacheResolution = {
  entry: NonNullable<ReturnType<typeof lookupCache>>;
  humanEdited: boolean;
};

export function lookupComponentCache(
  db: ReturnType<typeof openPipelineDb>,
  component: RawComponentDefinition & { component_id: string },
  promptHash: string,
): ReturnType<typeof lookupCache> {
  const normalized = normalizeComponentForCache(component);
  const inputHash = computeComponentInputHash(normalized);
  const cached = lookupCache(db, inputHash, 'component', component.component_id, promptHash);
  if (cached) return cached;
  const legacyInputHash = computeComponentInputHash(component);
  return legacyInputHash === inputHash
    ? null
    : lookupCache(db, legacyInputHash, 'component', component.component_id, promptHash);
}

export function resolveComponentCache(
  db: ReturnType<typeof openPipelineDb>,
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
  return pinned?.humanEdited &&
    findUnknownSlotAllowedComponents(db, pinned.sourceSessionId, allowedComponentNames, component.component_id)
      .length === 0
    ? { entry: pinned, humanEdited: true }
    : null;
}
