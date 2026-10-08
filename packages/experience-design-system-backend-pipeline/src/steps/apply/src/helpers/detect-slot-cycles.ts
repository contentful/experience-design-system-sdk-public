import type { CDFComponentEntry } from '../../../shared/index.js';
import type { SlotCycle } from '../../../composition/src/types/graph.js';
import { findSlotCycles } from '../../../composition/src/helpers/find-slot-cycles.js';

/**
 * Detects slot cycles in a CDF document that's about to be sent. Thin wrapper
 * that reshapes CDF entries into the generic graph input and delegates to the
 * composition cycle detector.
 */
export function detectSlotCycles(components: Array<{ key: string; entry: CDFComponentEntry }>): SlotCycle[] {
  const cycleInput = components.map(({ key, entry }) => ({
    name: key,
    slots: Object.entries(entry.$slots ?? {}).map(([slotName, slotDef]) => ({
      name: slotName,
      allowedComponents: slotDef.$allowedComponents ?? [],
    })),
  }));
  return findSlotCycles(cycleInput);
}
