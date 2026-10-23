import type { ComponentGraphNode } from './composite-closure.js';

export function computeDirectNeighborhood(matches: Iterable<string>, graph: ComponentGraphNode[]): Set<string> {
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

export function findAllAncestors(target: string, graph: ComponentGraphNode[]): Set<string> {
  const out = new Set<string>([target]);
  const parentsOf = new Map<string, string[]>();
  for (const node of graph) {
    for (const slot of node.slots) {
      for (const child of slot.allowedComponents ?? []) {
        const list = parentsOf.get(child);
        if (list) {
          if (!list.includes(node.name)) list.push(node.name);
        } else {
          parentsOf.set(child, [node.name]);
        }
      }
    }
  }
  const queue: string[] = [target];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const parents = parentsOf.get(cur);
    if (!parents) continue;
    for (const p of parents) {
      if (out.has(p)) continue;
      out.add(p);
      queue.push(p);
    }
  }
  return out;
}
