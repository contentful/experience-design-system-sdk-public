import type { ComponentGraphNode, SlotCycle } from '../../types/graph.js';
import { buildAdjacency } from '../graph/build-adjacency.js';
import { collectSelfLoops } from './collect-self-loops.js';
import { findElementaryCircuits } from './find-elementary-circuits.js';
import { stronglyConnectedComponents } from './strongly-connected-components.js';

/** All elementary slot-reference cycles in the composed-component graph. */
export function findSlotCycles(components: ComponentGraphNode[]): SlotCycle[] {
  if (components.length === 0) return [];
  const { nodes, adjacency } = buildAdjacency(components);
  if (nodes.length === 0) return [];

  const cycles: SlotCycle[] = [];
  collectSelfLoops(nodes, adjacency, cycles);

  let remaining = [...nodes].sort();
  while (remaining.length > 0) {
    const sccs = stronglyConnectedComponents(remaining, adjacency).filter((scc) => scc.length > 1);
    if (sccs.length === 0) break;
    const start = pickStartSccMinNode(sccs);
    if (!start) break;
    findElementaryCircuits(start.node, start.scc, adjacency, cycles);
    remaining = remaining.filter((n) => n !== start.node);
  }
  return cycles;
}

function pickStartSccMinNode(sccs: string[][]): { node: string; scc: string[] } | null {
  let bestNode: string | null = null;
  let bestScc: string[] | null = null;
  for (const scc of sccs) {
    const min = [...scc].sort()[0];
    if (bestNode === null || min < bestNode) {
      bestNode = min;
      bestScc = scc;
    }
  }
  return bestNode && bestScc ? { node: bestNode, scc: bestScc } : null;
}
