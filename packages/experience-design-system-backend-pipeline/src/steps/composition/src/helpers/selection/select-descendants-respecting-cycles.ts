import type { ComponentGraphNode } from '../../types/graph.js';
import { slotTargetsOf } from '../graph/slot-targets-of.js';

/**
 * Walk forward from `target` through slot edges. Whenever we touch a node in
 * a cycle group, pull the whole group in — cycles accept as a unit.
 */
export function selectDescendantsRespectingCycles(
  target: string,
  components: ComponentGraphNode[],
  cycleGroups: Map<string, Set<string>>,
): Set<string> {
  const byName = new Map(components.map((c) => [c.name, c]));
  const visited = new Set<string>();
  const queue: string[] = [];

  const enqueue = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    queue.push(name);
    const group = cycleGroups.get(name);
    if (!group) return;
    for (const member of group) {
      if (!visited.has(member)) {
        visited.add(member);
        queue.push(member);
      }
    }
  };

  enqueue(target);
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of slotTargetsOf(cur, byName)) enqueue(next);
  }
  return visited;
}
