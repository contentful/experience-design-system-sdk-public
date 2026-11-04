import { findSlotCycles } from '../../../steps/composition/src/helpers/cycles/find-slot-cycles.js';
import { suggestCycleBreakEdge } from '../../../steps/composition/src/helpers/cycles/suggest-cycle-break-edge.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { SlotCycle, SlotEdge } from '../../../steps/composition/src/types/graph.js';

export function calculateSlotCycles(
  components: RawComponentDefinition[],
): Array<SlotCycle & { suggestedBreak?: SlotEdge | null }> {
  const graph = components.map((c) => ({
    name: c.name,
    slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
  }));
  const cycles = findSlotCycles(graph);
  return cycles.map((cycle) => ({ ...cycle, suggestedBreak: suggestCycleBreakEdge(cycle, cycles) }));
}
