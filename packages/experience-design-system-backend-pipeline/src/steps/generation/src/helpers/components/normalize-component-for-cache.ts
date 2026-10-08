import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';

/**
 * Normalize empty slot names before cache-key derivation. Legacy data wrote
 * slots with blank names; hashing their original shape would make the cache
 * miss forever for that component. Returns a shallow copy with slot names
 * replaced by `children` (single slot) or `slot_N` (multi-slot).
 */
export function normalizeComponentForCache(
  component: RawComponentDefinition & { component_id?: string },
): RawComponentDefinition & { component_id?: string } {
  const slots = component.slots.map((slot, index, allSlots) => ({
    ...slot,
    name: slot.name.trim() || (allSlots.length === 1 ? 'children' : `slot_${index}`),
  }));
  return { ...component, slots };
}
