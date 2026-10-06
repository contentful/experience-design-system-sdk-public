import {
  computeComponentInputHash,
  lookupCache,
  lookupCacheByEntity,
  findUnknownSlotAllowedComponents,
} from '../../session/db.js';
import type { openPipelineDb } from '../../session/db.js';
import type { RawComponentDefinition } from '../../types.js';
import { c } from '../../output/format.js';

export interface ComponentRunResult {
  componentName: string;
  classified: number;
  excluded: number;
  slots: number;
  warnings: string[];
  failed: boolean;
  error?: string;
  cached?: boolean;
  renamedSlotsCount: number;
}

export type ComponentCacheResolution = {
  entry: NonNullable<ReturnType<typeof lookupCache>>;
  humanEdited: boolean;
};

export function normalizeComponentForCache(
  component: RawComponentDefinition & { component_id?: string },
): RawComponentDefinition & { component_id?: string } {
  const slots = component.slots.map((slot, index, allSlots) => ({
    ...slot,
    name: slot.name.trim() || (allSlots.length === 1 ? 'children' : `slot_${index}`),
  }));
  return { ...component, slots };
}

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

export function createCachedComponentResult(componentName: string, warnings: string[] = []): ComponentRunResult {
  return {
    componentName,
    classified: 0,
    excluded: 0,
    slots: 0,
    warnings,
    failed: false,
    cached: true,
    renamedSlotsCount: 0,
  };
}

export function writeCachedComponentStatus(position: string, componentName: string, pinned: boolean): void {
  const status = pinned ? c.cyan('pinned (human-edited)') : c.green('cached');
  process.stderr.write(`  ${position}  ${c.bold(componentName)}  ${status}\n`);
}
