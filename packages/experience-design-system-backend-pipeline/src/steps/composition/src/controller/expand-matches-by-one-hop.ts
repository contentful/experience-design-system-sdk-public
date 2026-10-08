import { expandMatchesByOneHop as impl } from '../helpers/expand-matches-by-one-hop.js';
import type { ComponentGraphNode } from '../types/graph.js';

export interface ExpandMatchesByOneHopRequest {
  matches: Iterable<string>;
  graph: ComponentGraphNode[];
}

export function expandMatchesByOneHop(request: ExpandMatchesByOneHopRequest): Set<string> {
  return impl(request.matches, request.graph);
}
