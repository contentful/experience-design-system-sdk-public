import { rejectAncestorsRespectingCycles as impl } from '../../helpers/selection/reject-ancestors-respecting-cycles.js';
import type { ComponentGraphNode, CycleAwareRejectResult } from '../../types/graph.js';

export interface RejectAncestorsRespectingCyclesRequest {
  target: string;
  graph: ComponentGraphNode[];
  cycleGroups: Map<string, Set<string>>;
}

export function rejectAncestorsRespectingCycles(
  request: RejectAncestorsRespectingCyclesRequest,
): CycleAwareRejectResult {
  return impl(request.target, request.graph, request.cycleGroups);
}
