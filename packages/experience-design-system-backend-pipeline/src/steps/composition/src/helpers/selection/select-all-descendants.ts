import type { ComponentGraphNode } from '../../types/graph.js';
import { walkReachable } from '../graph/walk-reachable.js';

/**
 * All components reachable forward from `target` through slot-allowedComponents
 * edges, including `target` itself. The accept-cascade when there are no
 * cycle considerations.
 */
export function selectAllDescendants(target: string, components: ComponentGraphNode[]): Set<string> {
  const known = new Set(components.map((c) => c.name));
  const byName = new Map(components.map((c) => [c.name, c]));
  const out = new Set<string>();
  out.add(target);
  for (const name of walkReachable(target, byName, known)) {
    out.add(name);
  }
  return out;
}
