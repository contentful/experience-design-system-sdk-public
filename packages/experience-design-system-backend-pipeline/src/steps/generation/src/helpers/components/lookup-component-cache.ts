import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import {
  computeComponentInputHash,
  lookupCache,
  type CacheEntry,
} from '../../../../../persistence/src/session/repositories/db.js';
import { normalizeComponentForCache } from './normalize-component-for-cache.js';

/**
 * Look up a component cache entry, trying the normalized-slot-name hash first
 * and falling back to the pre-normalization legacy hash for entries written
 * before empty slot names were canonicalized.
 */
export function lookupComponentCache(
  db: DatabaseSync,
  component: RawComponentDefinition & { component_id: string },
  promptHash: string,
): CacheEntry | null {
  const normalized = normalizeComponentForCache(component);
  const inputHash = computeComponentInputHash(normalized);
  const cached = lookupCache(db, inputHash, 'component', component.component_id, promptHash);
  if (cached) return cached;

  const legacyInputHash = computeComponentInputHash(component);
  return legacyInputHash === inputHash
    ? null
    : lookupCache(db, legacyInputHash, 'component', component.component_id, promptHash);
}
