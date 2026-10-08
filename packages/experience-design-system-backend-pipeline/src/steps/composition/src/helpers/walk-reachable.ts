import type { ComponentGraphNode } from '../types/graph.js';
import { edgesFromNode } from './edges-from-node.js';

/** Depth-first walk from root through allowedComponents edges; returns the set of reachable node names. */
export function walkReachable(root: string, byName: Map<string, ComponentGraphNode>, known: Set<string>): Set<string> {
  const reachable = new Set<string>();
  const stack: string[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    for (const next of edgesFromNode(byName.get(cur), known)) {
      if (!reachable.has(next)) stack.push(next);
    }
  }
  return reachable;
}
