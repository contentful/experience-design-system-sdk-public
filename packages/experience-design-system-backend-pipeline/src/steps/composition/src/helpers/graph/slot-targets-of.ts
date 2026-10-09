import type { ComponentGraphNode } from '../../types/graph.js';

/** Deduped list of slot-allowedComponents targets reachable from `node`. */
export function slotTargetsOf(node: string, byName: Map<string, ComponentGraphNode>): string[] {
  const c = byName.get(node);
  if (!c) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slot of c.slots) {
    for (const target of slot.allowedComponents ?? []) {
      if (!byName.has(target)) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}
