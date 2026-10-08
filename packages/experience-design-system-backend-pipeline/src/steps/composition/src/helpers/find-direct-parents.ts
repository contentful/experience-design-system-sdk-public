import type { ComponentGraphNode } from '../types/graph.js';

export interface DirectParentEdge {
  parent: string;
  slotName: string;
}

export function findDirectParents(target: string, components: ComponentGraphNode[]): DirectParentEdge[] {
  const out: DirectParentEdge[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    if (c.name === target) continue;
    for (const slot of c.slots) {
      const allowed = slot.allowedComponents ?? [];
      if (!allowed.includes(target)) continue;
      const key = `${c.name} ${slot.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ parent: c.name, slotName: slot.name });
    }
  }
  out.sort((a, b) => a.parent.localeCompare(b.parent) || a.slotName.localeCompare(b.slotName));
  return out;
}
