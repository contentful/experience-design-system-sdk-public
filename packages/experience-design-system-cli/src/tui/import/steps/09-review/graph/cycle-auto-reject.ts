import type { ComponentGraphNode } from '../../07-scope-gate/graph/composite-closure.js';
import { findAllAncestors } from '../../07-scope-gate/graph/lineage.js';

export function computeCycleAutoRejectTargets(
  slotCycles: Array<{ path: string[] }>,
  graph: ComponentGraphNode[],
): Set<string> {
  const targets = new Set<string>();
  const participants = new Set<string>();
  for (const cyc of slotCycles) for (const p of cyc.path) participants.add(p);
  for (const p of participants) {
    targets.add(p);
    for (const anc of findAllAncestors(p, graph)) targets.add(anc);
  }
  return targets;
}
