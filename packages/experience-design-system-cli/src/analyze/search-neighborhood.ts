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
