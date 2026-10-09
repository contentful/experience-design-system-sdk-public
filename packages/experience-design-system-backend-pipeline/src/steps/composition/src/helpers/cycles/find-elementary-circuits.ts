import type { SlotCycle, SlotEdge } from '../../types/graph.js';
import type { AdjEntry } from '../graph/build-adjacency.js';

/**
 * Johnson's elementary-circuits algorithm, scoped to one strongly connected
 * component. Appends every elementary cycle through `startNode` into `cycles`.
 */
export function findElementaryCircuits(
  startNode: string,
  scc: string[],
  adjacency: Map<string, AdjEntry[]>,
  cycles: SlotCycle[],
): void {
  const sccSet = new Set(scc);
  const blocked = new Set<string>();
  const blockedMap = new Map<string, Set<string>>();
  const pathStack: string[] = [];
  const edgeStack: SlotEdge[] = [];

  function unblock(u: string): void {
    blocked.delete(u);
    const deps = blockedMap.get(u);
    if (!deps) return;
    for (const w of deps) if (blocked.has(w)) unblock(w);
    deps.clear();
  }

  function circuit(v: string, root: string): boolean {
    let found = false;
    pathStack.push(v);
    blocked.add(v);
    const outgoing = adjacency.get(v) ?? [];
    for (const { target: w, slotName } of outgoing) {
      if (!sccSet.has(w)) continue;
      edgeStack.push({ fromComponent: v, slotName, toComponent: w });
      if (w === root) {
        cycles.push({ path: [...pathStack, pathStack[0]], edges: [...edgeStack] });
        found = true;
      } else if (!blocked.has(w) && circuit(w, root)) {
        found = true;
      }
      edgeStack.pop();
    }
    if (found) {
      unblock(v);
    } else {
      for (const { target: w } of outgoing) {
        if (!sccSet.has(w)) continue;
        let deps = blockedMap.get(w);
        if (!deps) {
          deps = new Set();
          blockedMap.set(w, deps);
        }
        deps.add(v);
      }
    }
    pathStack.pop();
    return found;
  }

  circuit(startNode, startNode);
}
