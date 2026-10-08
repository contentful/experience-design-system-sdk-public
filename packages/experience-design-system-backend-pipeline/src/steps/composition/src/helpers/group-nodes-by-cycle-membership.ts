import type { SlotCycle } from '../types/graph.js';

/**
 * Union-find over cycle paths — each node maps to the set of nodes it shares a
 * cycle with (its "cycle group"). Nodes outside any cycle are absent from the map.
 */
export function groupNodesByCycleMembership(slotCycles: SlotCycle[]): Map<string, Set<string>> {
  const parent = new Map<string, string>();

  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      cur = parent.get(cur) as string;
    }
    let walk = x;
    while (parent.get(walk) !== cur) {
      const next = parent.get(walk) as string;
      parent.set(walk, cur);
      walk = next;
    }
    return cur;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const cycle of slotCycles) {
    for (const node of cycle.path) {
      if (!parent.has(node)) parent.set(node, node);
    }
    for (let i = 1; i < cycle.path.length; i++) {
      union(cycle.path[0], cycle.path[i]);
    }
  }

  const groups = new Map<string, Set<string>>();
  for (const node of parent.keys()) {
    const root = find(node);
    let group = groups.get(root);
    if (!group) {
      group = new Set<string>();
      groups.set(root, group);
    }
    group.add(node);
  }

  const out = new Map<string, Set<string>>();
  for (const group of groups.values()) {
    for (const node of group) out.set(node, group);
  }
  return out;
}
