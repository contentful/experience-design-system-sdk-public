import type { Closure } from '../../analyze/composite-closure.js';

/**
 * Resolve the collapse-group root that a sidebar row key belongs to.
 *
 * Precedence:
 *  1. A cycle participant is its own root (cycle-tier rows key their expand
 *     state on the participant name itself).
 *  2. A closure root is its own root.
 *  3. Otherwise, the row is a descendant — return the closure root whose
 *     `nodes` contain it.
 *  4. Unknown key → `undefined`.
 *
 * Step-agnostic: callers pass the step's own cycle set (GenerateReview uses
 * `cycleView.structural`; ScopeGate uses `cycleParticipants`).
 */
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
