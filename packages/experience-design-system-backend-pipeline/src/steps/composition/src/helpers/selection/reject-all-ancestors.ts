import type { ComponentGraphNode } from '../../types/graph.js';
import { findAllParents } from '../graph/find-all-parents.js';

/**
 * `target` plus every ancestor reachable backward through parent edges.
 * The reject-cascade when there are no cycle considerations.
 */
export function rejectAllAncestors(target: string, components: ComponentGraphNode[]): Set<string> {
  const out = new Set<string>();
  out.add(target);
  for (const ancestor of findAllParents(target, components)) {
    out.add(ancestor);
  }
  return out;
}
