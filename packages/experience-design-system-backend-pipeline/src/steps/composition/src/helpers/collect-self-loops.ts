import type { SlotCycle } from '../types/graph.js';
import type { AdjEntry } from './build-adjacency.js';

/** Append every self-referencing edge as a one-node cycle. */
export function collectSelfLoops(nodes: string[], adjacency: Map<string, AdjEntry[]>, cycles: SlotCycle[]): void {
  for (const node of nodes) {
    for (const edge of adjacency.get(node) ?? []) {
      if (edge.target !== node) continue;
      cycles.push({
        path: [node, node],
        edges: [{ fromComponent: node, slotName: edge.slotName, toComponent: node }],
      });
    }
  }
}
