import { propagateDescendantIssuesToAncestors as impl } from '../../helpers/selection/propagate-descendant-issues-to-ancestors.js';
import type { Closure, NodeStatus, RenderStatus } from '../../types/graph.js';

export interface PropagateDescendantIssuesToAncestorsRequest {
  closure: Closure;
  directIssues: Map<string, NodeStatus>;
}

export function propagateDescendantIssuesToAncestors(
  request: PropagateDescendantIssuesToAncestorsRequest,
): Map<string, RenderStatus> {
  return impl(request.closure, request.directIssues);
}
