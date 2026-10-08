import { findSlotCycles as impl } from '../../helpers/cycles/find-slot-cycles.js';
import type { ComponentGraphNode, SlotCycle } from '../../types/graph.js';

export interface FindSlotCyclesRequest {
  graph: ComponentGraphNode[];
}

export function findSlotCycles(request: FindSlotCyclesRequest): SlotCycle[] {
  return impl(request.graph);
}
