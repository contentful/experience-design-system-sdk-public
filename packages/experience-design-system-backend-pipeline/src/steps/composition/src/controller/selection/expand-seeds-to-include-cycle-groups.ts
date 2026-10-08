import { expandSeedsToIncludeCycleGroups as impl } from '../../helpers/selection/expand-seeds-to-include-cycle-groups.js';
import type { ComponentGraphNode } from '../../types/graph.js';

export interface ExpandSeedsToIncludeCycleGroupsRequest {
  seeds: string[];
  graph: ComponentGraphNode[];
  cycleGroups: Map<string, Set<string>>;
}

export function expandSeedsToIncludeCycleGroups(request: ExpandSeedsToIncludeCycleGroupsRequest): Set<string> {
  return impl(request.seeds, request.graph, request.cycleGroups);
}
