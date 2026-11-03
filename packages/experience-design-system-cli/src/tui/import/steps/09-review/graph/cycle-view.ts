import type { SlotCycle } from '../../07-scope-gate/graph/cycle-detection.js';
import { findSlotCycles } from '../../07-scope-gate/graph/cycle-detection.js';
import { buildComponentGraph, type SlotGraphInput } from '../../07-scope-gate/graph/slot-graph.js';
import { componentCompositionDefinitions } from '@contentful/experience-design-system-types';

/** Complete source-owned model slots describe data, while ordinary slots retain composition checks. */
export function buildVisualComponentGraph(components: SlotGraphInput[]) {
  return buildComponentGraph(componentCompositionDefinitions(components));
}

export interface CycleView {
  pushBlocking: SlotCycle[];
  structural: Set<string>;
  error?: string;
}

export function computeCycleView(components: SlotGraphInput[]): CycleView {
  const rejected = new Set(components.filter((row) => row.status === 'rejected').map((row) => row.key));

  let pushBlocking: SlotCycle[] = [];
  const structural = new Set<string>();

  try {
    const visualGraph = buildVisualComponentGraph(components);
    pushBlocking = findSlotCycles(visualGraph.filter((row) => !rejected.has(row.name)));
    for (const cyc of pushBlocking) for (const p of cyc.path) structural.add(p);
    const unfilteredCycles = findSlotCycles(visualGraph);
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
