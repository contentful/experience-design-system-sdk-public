import type { ComponentGraphNode, CycleAwareRejectResult } from '../../types/graph.js';
import { findDirectParents } from '../graph/find-direct-parents.js';
import { selectDescendantsRespectingCycles } from './select-descendants-respecting-cycles.js';

/**
 * Walk backward from `target` through parent edges. Whenever we add a node that
 * sits in a cycle group, pull the whole group in. Returns the set to reject,
 * the set to deselect (descendants no longer reachable), and the cycle partners.
 */
export function rejectAncestorsRespectingCycles(
  target: string,
  components: ComponentGraphNode[],
  cycleGroups: Map<string, Set<string>>,
): CycleAwareRejectResult {
  const toReject = new Set<string>();
  const targetGroup = cycleGroups.get(target);
  const seeds: string[] = targetGroup ? [...targetGroup] : [target];
  for (const seed of seeds) toReject.add(seed);

  const stack: string[] = [...toReject];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const { parent } of findDirectParents(cur, components)) {
      if (toReject.has(parent)) continue;
      toReject.add(parent);
      stack.push(parent);
      const group = cycleGroups.get(parent);
      if (!group) continue;
      for (const member of group) {
        if (!toReject.has(member)) {
          toReject.add(member);
          stack.push(member);
        }
      }
    }
  }

  const acceptCascade = selectDescendantsRespectingCycles(target, components, cycleGroups);
  const toDeselect = new Set<string>();
  for (const n of acceptCascade) {
    if (!toReject.has(n)) toDeselect.add(n);
  }

  const cyclePartners: string[] = [];
  if (targetGroup) {
    for (const m of targetGroup) {
      if (m !== target) cyclePartners.push(m);
    }
    cyclePartners.sort();
  }

  return { toReject, toDeselect, cyclePartners };
}
