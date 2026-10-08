import type { SlotCycle } from '../../../composition/src/types/graph.js';
import { formatCyclePath } from '../../../composition/src/helpers/cycles/format-cycle-path.js';
import { suggestCycleBreakEdge } from '../../../composition/src/helpers/cycles/suggest-cycle-break-edge.js';

/** Multi-line stderr-ready report of detected slot cycles with suggested fixes. */
export function formatSlotCycleReport(cycles: SlotCycle[]): string[] {
  const lines: string[] = [];
  lines.push(
    `Error: manifest:components/slot-cycles — ${cycles.length} slot dependency cycle(s) detected. Push refused.`,
  );
  for (let i = 0; i < cycles.length; i += 1) {
    const cycle = cycles[i];
    lines.push(`  Cycle ${i + 1}: ${formatCyclePath(cycle)}`);
    const suggested = suggestCycleBreakEdge(cycle, cycles);
    lines.push(
      `    Fix: remove '${suggested.toComponent}' from ${suggested.fromComponent}.$slots.${suggested.slotName}.$allowedComponents`,
    );
  }
  return lines;
}
