import type { Closure } from '../../analyze/composite-closure.js';

export function resolveGroupRoot(
  key: string,
  closures: Map<string, Closure>,
  cycleSet: Set<string>,
): string | undefined {
  if (cycleSet.has(key)) return key;
  if (closures.has(key)) return key;
  for (const [root, closure] of closures.entries()) {
    if (closure.nodes.some((n) => n.name === key)) return root;
  }
  return undefined;
}
