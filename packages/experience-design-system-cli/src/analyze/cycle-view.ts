import type { SlotCycle } from './cycle-detection.js';
import { findSlotCycles } from './cycle-detection.js';
import { buildComponentGraph, type SlotGraphInput } from './slot-graph.js';

export interface CycleView {
  pushBlocking: SlotCycle[];
  structural: Set<string>;
}

export function computeCycleView(components: SlotGraphInput[]): CycleView {
  const filtered = components.filter((c) => c.status !== 'rejected');
  const filteredGraph = buildComponentGraph(filtered);
  const unfilteredGraph = buildComponentGraph(components);

  let pushBlocking: SlotCycle[] = [];
  const structural = new Set<string>();

  try {
    pushBlocking = findSlotCycles(filteredGraph);
    for (const cyc of pushBlocking) for (const p of cyc.path) structural.add(p);
  } catch {
    // Malformed slot data — intentional swallow.
  }
  try {
    const unfilteredCycles = findSlotCycles(unfilteredGraph);
    for (const cyc of unfilteredCycles) for (const p of cyc.path) structural.add(p);
  } catch {
    // Malformed slot data — intentional swallow.
  }

  return { pushBlocking, structural };
}
