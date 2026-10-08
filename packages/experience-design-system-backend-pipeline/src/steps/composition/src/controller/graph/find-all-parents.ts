import { findAllParents as impl } from '../../helpers/graph/find-all-parents.js';
import type { ComponentGraphNode } from '../../types/graph.js';

export interface FindAllParentsRequest {
  target: string;
  graph: ComponentGraphNode[];
}

export function findAllParents(request: FindAllParentsRequest): Set<string> {
  return impl(request.target, request.graph);
}
