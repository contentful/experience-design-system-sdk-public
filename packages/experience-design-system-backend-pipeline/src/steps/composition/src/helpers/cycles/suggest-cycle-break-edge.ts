import type { SlotCycle, SlotEdge } from '../../types/graph.js';

/**
 * Pick the edge whose target has the highest cycle-indegree across all
 * provided cycles — breaking that edge disrupts the most cycles.
 */
export function suggestCycleBreakEdge(cycle: SlotCycle, allCycles: SlotCycle[]): SlotEdge {
  if (cycle.edges.length === 0) {
    throw new Error('suggestCycleBreakEdge: cycle has no edges');
  }
  const indegree = new Map<string, number>();
  for (const c of allCycles) {
    for (const edge of c.edges) {
      indegree.set(edge.toComponent, (indegree.get(edge.toComponent) ?? 0) + 1);
    }
  }
  let best = cycle.edges[0];
  let bestScore = indegree.get(best.toComponent) ?? 0;
  for (const edge of cycle.edges) {
    const score = indegree.get(edge.toComponent) ?? 0;
    if (score > bestScore) {
      best = edge;
      bestScore = score;
    }
  }
  return best;
}
