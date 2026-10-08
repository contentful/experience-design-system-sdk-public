import type { ComponentGraphNode } from '../../types/graph.js';

export interface AdjEntry {
  target: string;
  slotName: string;
}

/** Build name list + adjacency map (edges weighted with the originating slot name). */
export function buildAdjacency(components: ComponentGraphNode[]): {
  nodes: string[];
  adjacency: Map<string, AdjEntry[]>;
} {
  const nodes: string[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    nodes.push(c.name);
  }
  const adjacency = new Map<string, AdjEntry[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const comp of components) {
    const outgoing = adjacency.get(comp.name);
    if (!outgoing) continue;
    for (const slot of comp.slots) {
      for (const target of slot.allowedComponents ?? []) {
        if (!seen.has(target)) continue;
        outgoing.push({ target, slotName: slot.name });
      }
    }
  }
  return { nodes, adjacency };
}
