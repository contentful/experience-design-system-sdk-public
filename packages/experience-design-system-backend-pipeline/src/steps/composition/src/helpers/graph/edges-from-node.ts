import type { ComponentGraphNode } from '../../types/graph.js';

/** Deduped, sorted list of slot-allowedComponents targets from a node (filtered to known components). */
export function edgesFromNode(component: ComponentGraphNode | undefined, known: Set<string>): string[] {
  if (!component) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slot of component.slots) {
    for (const target of slot.allowedComponents ?? []) {
      if (!known.has(target)) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      out.push(target);
    }
  }
  return out.sort();
}
