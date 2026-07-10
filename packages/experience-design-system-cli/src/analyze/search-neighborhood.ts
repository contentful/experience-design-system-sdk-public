import type { ComponentGraphNode } from './composite-closure.js';

/**
 * Compute the "direct neighborhood" of a set of search matches over the
 * component graph: the matches themselves, every component that directly slots
 * a match (direct-parents, one level up), and every component a match directly
 * slots (direct-children, one level down).
 *
 * Neighborhood is DIRECT only — not transitive. Used at the step level to
 * derive the reusable `filterVisibleKeys` prop consumed by GroupedSidebar's
 * grouped-view row filter (see plan §B T4 / T5).
 *
 * Returns an empty set when `matches` is empty, so callers can key their
 * "filter active?" branch off `matches.length > 0` and pass the result
 * verbatim.
 */
export function computeDirectNeighborhood(
  matches: Iterable<string>,
  graph: ComponentGraphNode[],
): Set<string> {
  const matchSet = new Set(matches);
  const out = new Set<string>(matchSet);
  if (matchSet.size === 0) return out;
  for (const node of graph) {
    const targets: string[] = [];
    for (const slot of node.slots) {
      for (const t of slot.allowedComponents ?? []) targets.push(t);
    }
    if (matchSet.has(node.name)) {
      // Direct-children: everything this match slots.
      for (const t of targets) out.add(t);
    }
    for (const t of targets) {
      if (matchSet.has(t)) {
        // Direct-parents: node slots a match.
        out.add(node.name);
        break;
      }
    }
  }
  return out;
}

/**
 * Compute the transitive-ancestor closure of a target component over the
 * component graph: the target plus every composite that transitively slots it
 * (reverse-BFS along `slots[].allowedComponents` edges). Used by the step-
 * level jump-and-filter `[i]` handler to build a `filterVisibleKeys` set
 * (see plan §B T5).
 *
 * Traversal uses a visited set so cycles cannot cause infinite recursion.
 * Semantically distinct from `computeDirectNeighborhood` — this walk is
 * transitive and up-only (no descendants).
 */
export function findAllAncestors(
  target: string,
  graph: ComponentGraphNode[],
): Set<string> {
  const out = new Set<string>([target]);
  // Reverse adjacency: node.name → set of names that slot it. Built once so
  // repeated jump-filter invocations don't rescan the full graph each hop.
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
