import { selectDescendantsRespectingCycles as impl } from '../helpers/select-descendants-respecting-cycles.js';
import type { ComponentGraphNode } from '../types/graph.js';

export interface SelectDescendantsRespectingCyclesRequest {
  target: string;
  graph: ComponentGraphNode[];
  cycleGroups: Map<string, Set<string>>;
}

export function selectDescendantsRespectingCycles(request: SelectDescendantsRespectingCyclesRequest): Set<string> {
  return impl(request.target, request.graph, request.cycleGroups);
}
