import type { ComponentGraphNode } from '../../types/graph.js';
import { findDirectParents } from './find-direct-parents.js';

export function findAllParents(target: string, components: ComponentGraphNode[]): Set<string> {
  const out = new Set<string>([target]);
  const queue: string[] = [target];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const { parent } of findDirectParents(cur, components)) {
      if (out.has(parent)) continue;
      out.add(parent);
      queue.push(parent);
    }
  }
  return out;
}
