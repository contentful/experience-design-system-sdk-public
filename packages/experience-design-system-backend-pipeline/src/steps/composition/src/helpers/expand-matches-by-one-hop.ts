import type { ComponentGraphNode } from '../types/graph.js';

/**
 * Starting from a match set, include every direct parent AND direct child
 * reachable in one hop through the slot-allowedComponents edges.
 */
export function expandMatchesByOneHop(matches: Iterable<string>, graph: ComponentGraphNode[]): Set<string> {
  const matchSet = new Set(matches);
  const out = new Set<string>(matchSet);
  if (matchSet.size === 0) return out;
  for (const node of graph) {
    const targets: string[] = [];
    for (const slot of node.slots) {
      for (const t of slot.allowedComponents ?? []) targets.push(t);
    }
    if (matchSet.has(node.name)) {
      for (const t of targets) out.add(t);
    }
    for (const t of targets) {
      if (matchSet.has(t)) {
        out.add(node.name);
        break;
      }
    }
  }
  return out;
}
