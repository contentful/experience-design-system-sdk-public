import type { Closure, ClosureNode, ComponentGraphNode, SlotCycle } from '../../types/graph.js';
import { edgesFromNode } from './edges-from-node.js';
import { findSlotCycles } from '../cycles/find-slot-cycles.js';
import { walkReachable } from './walk-reachable.js';

/** The transitive closure rooted at `root`, with a BFS shortest-path to each descendant. */
export function computeClosure(root: string, components: ComponentGraphNode[]): Closure {
  const known = new Set(components.map((c) => c.name));
  const byName = new Map(components.map((c) => [c.name, c]));

  if (!known.has(root)) {
    return {
      root,
      nodes: [{ name: root, depth: 0, path: [root], parents: [] }],
      containsCycle: false,
    };
  }

  const reachable = walkReachable(root, byName, known);
  const cyclePath = findCycleInClosure(root, reachable, components);
  if (cyclePath) {
    const nodes: ClosureNode[] = [...reachable].sort().map((name) => ({
      name,
      depth: name === root ? 0 : 1,
      path: [root],
      parents: [],
    }));
    return { root, nodes, containsCycle: true, cyclePath };
  }

  return bfsClosure(root, byName, known);
}

function findCycleInClosure(root: string, reachable: Set<string>, components: ComponentGraphNode[]): string[] | null {
  const scoped = components.filter((c) => reachable.has(c.name)).map((c) => ({ name: c.name, slots: c.slots }));
  const cycles: SlotCycle[] = findSlotCycles(scoped);
  if (cycles.length === 0) return null;
  const involvesRoot = cycles.find((cycle) => cycle.path.includes(root));
  const picked = involvesRoot ?? cycles[0];
  return picked.path;
}

function bfsClosure(root: string, byName: Map<string, ComponentGraphNode>, known: Set<string>): Closure {
  const depth = new Map<string, number>();
  const parentPath = new Map<string, string[]>();
  const parents = new Map<string, Set<string>>();

  depth.set(root, 0);
  parentPath.set(root, [root]);
  parents.set(root, new Set());

  const queue: string[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const curDepth = depth.get(cur) as number;
    const curPath = parentPath.get(cur) as string[];
    for (const next of edgesFromNode(byName.get(cur), known)) {
      if (!parents.has(next)) parents.set(next, new Set());
      (parents.get(next) as Set<string>).add(cur);
      const nextDepth = curDepth + 1;
      const existingDepth = depth.get(next);
      const nextPath = [...curPath, next];
      if (existingDepth === undefined || nextDepth < existingDepth) {
        depth.set(next, nextDepth);
        parentPath.set(next, nextPath);
        queue.push(next);
      } else if (nextDepth === existingDepth) {
        const existingPath = parentPath.get(next) as string[];
        if (nextPath.join(' ') < existingPath.join(' ')) parentPath.set(next, nextPath);
      }
    }
  }

  const nodes: ClosureNode[] = [];
  for (const [name, d] of depth.entries()) {
    nodes.push({
      name,
      depth: d,
      path: parentPath.get(name) as string[],
      parents: [...(parents.get(name) ?? new Set())].sort(),
    });
  }
  nodes.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  return { root, nodes, containsCycle: false };
}
