import { findWorstIssuedDescendant as impl } from '../helpers/find-worst-issued-descendant.js';
import type { Closure, NodeStatus } from '../types/graph.js';

export interface FindWorstIssuedDescendantRequest {
  ancestor: string;
  closure: Closure;
  directIssues: Map<string, NodeStatus>;
}

export function findWorstIssuedDescendant(request: FindWorstIssuedDescendantRequest): string | null {
  return impl(request.ancestor, request.closure, request.directIssues);
}
