import { rejectAllAncestors as impl } from '../helpers/reject-all-ancestors.js';
import type { ComponentGraphNode } from '../types/graph.js';

export interface RejectAllAncestorsRequest {
  target: string;
  graph: ComponentGraphNode[];
}

export function rejectAllAncestors(request: RejectAllAncestorsRequest): Set<string> {
  return impl(request.target, request.graph);
}
