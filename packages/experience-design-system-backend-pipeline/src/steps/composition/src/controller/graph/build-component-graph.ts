import { buildComponentGraph as impl } from '../../helpers/graph/build-component-graph.js';
import type { ComponentGraphInput, ComponentGraphNode } from '../../types/graph.js';

export interface BuildComponentGraphRequest {
  components: ComponentGraphInput[];
  stripRejectedEdges?: boolean;
}

export function buildComponentGraph(request: BuildComponentGraphRequest): ComponentGraphNode[] {
  const { components, stripRejectedEdges } = request;
  return impl(components, stripRejectedEdges !== undefined ? { stripRejectedEdges } : undefined);
}
