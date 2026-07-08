import type { ComponentGraphNode } from './composite-closure.js';
import { computeClosure } from './composite-closure.js';
import { findAllAncestors } from './lineage.js';

export function computeRejectCascade(
  target: string,
  components: ComponentGraphNode[],
): Set<string> {
  const out = new Set<string>();
  out.add(target);
  for (const ancestor of findAllAncestors(target, components)) {
    out.add(ancestor);
  }
  return out;
}

export function computeAcceptCascade(
  target: string,
  components: ComponentGraphNode[],
): Set<string> {
  const out = new Set<string>();
  out.add(target);
  const closure = computeClosure(target, components);
  for (const node of closure.nodes) {
    out.add(node.name);
  }
  return out;
}
