import { selectAllDescendants as impl } from '../../helpers/selection/select-all-descendants.js';
import type { ComponentGraphNode } from '../../types/graph.js';

export interface SelectAllDescendantsRequest {
  target: string;
  graph: ComponentGraphNode[];
}

export function selectAllDescendants(request: SelectAllDescendantsRequest): Set<string> {
  return impl(request.target, request.graph);
}
