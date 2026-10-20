import type { SlotCycle } from '../../07-scope-gate/graph/cycle-detection.js';
import { findSlotCycles } from '../../07-scope-gate/graph/cycle-detection.js';
import { buildComponentGraph, type SlotGraphInput } from '../../07-scope-gate/graph/slot-graph.js';

export interface CycleView {
  pushBlocking: SlotCycle[];
  structural: Set<string>;
  error?: string;
}

export function computeCycleView(components: SlotGraphInput[]): CycleView {
  const filtered = components.filter((c) => c.status !== 'rejected');

  let pushBlocking: SlotCycle[] = [];
  const structural = new Set<string>();

  try {
    pushBlocking = findSlotCycles(buildComponentGraph(filtered));
    for (const cyc of pushBlocking) for (const p of cyc.path) structural.add(p);
  } catch (error) {
    return {
      pushBlocking,
      structural,
      error: `Cannot verify component cycles: ${String(error)}. Fix the definitions and retry.`,
    };
  }
  try {
    const unfilteredCycles = findSlotCycles(buildComponentGraph(components));
    for (const cyc of unfilteredCycles) for (const p of cyc.path) structural.add(p);
  } catch (error) {
    return {
      pushBlocking,
      structural,
      error: `Cannot verify component cycles: ${String(error)}. Fix the definitions and retry.`,
    };
  }

  return { pushBlocking, structural };
}
