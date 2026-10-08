import type { AdjEntry } from '../graph/build-adjacency.js';

/** Tarjan's SCC algorithm. Returns groups of mutually-reachable nodes. */
export function stronglyConnectedComponents(nodes: string[], adjacency: Map<string, AdjEntry[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;
  const nodeSet = new Set(nodes);

  function strongconnect(v: string): void {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    const neighbours = adjacency.get(v) ?? [];
    for (const { target } of neighbours) {
      if (!nodeSet.has(target)) continue;
      if (!index.has(target)) {
        strongconnect(target);
        lowlink.set(v, Math.min(lowlink.get(v) as number, lowlink.get(target) as number));
      } else if (onStack.has(target)) {
        lowlink.set(v, Math.min(lowlink.get(v) as number, index.get(target) as number));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const node of nodes) {
    if (!index.has(node)) strongconnect(node);
  }
  return sccs;
}
