import type { RawComponentDefinition } from '../../types.js';

export function normalizeComponentForCache(
  component: RawComponentDefinition & { component_id?: string },
): RawComponentDefinition & { component_id?: string } {
  const slots = component.slots.map((slot, index, allSlots) => ({
    ...slot,
    name: slot.name.trim() || (allSlots.length === 1 ? 'children' : `slot_${index}`),
  }));
  return { ...component, slots };
}
