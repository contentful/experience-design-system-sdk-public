import type { ComponentGraphNode } from '../types/graph.js';
import { slotTargetsOf } from './slot-targets-of.js';

/**
 * Starting from `seeds`, walk forward through slot edges. Return every cycle
 * group reachable from any seed (so the caller can offer "include the whole
 * cycle" to the user).
 */
export function expandSeedsToIncludeCycleGroups(
  seeds: string[],
  components: ComponentGraphNode[],
  cycleGroups: Map<string, Set<string>>,
): Set<string> {
  const out = new Set<string>();
  if (cycleGroups.size === 0) return out;
  const byName = new Map(components.map((c) => [c.name, c]));
  const visited = new Set<string>();
  const queue: string[] = [...seeds];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const group = cycleGroups.get(cur);
    if (group) {
      for (const member of group) {
        out.add(member);
        if (!visited.has(member)) queue.push(member);
      }
    }
    for (const next of slotTargetsOf(cur, byName)) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return out;
}
