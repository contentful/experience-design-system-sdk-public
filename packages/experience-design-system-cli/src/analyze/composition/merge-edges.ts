import type { CompositionEdge, EdgeProvenance } from './interchange-schema.js';

/**
 * Provenance rank (spec T2). Lower number = higher trust = wins conflicts.
 *   1 user  >  2 typed-slot  >  3 structural  >  4 adapter:*  >  5 agent
 *
 * `structural` sits just below a declared slot contract: it's usage evidence
 * (a runtime type-predicate function, a `.type === Component` identity check,
 * direct JSX instantiation — see `structural-slot-evidence.ts`) rather than a
 * typed generic or explicit marker, so a declared contract always overrides
 * it on conflict, but it still outranks the LLM agent.
 */
function rank(p: EdgeProvenance): number {
  if (p === 'user') return 1;
  if (p === 'typed-slot') return 2;
  if (p === 'structural') return 3;
  if (p.startsWith('adapter:')) return 4;
  return 5; // agent
}

export type EdgeConflict = {
  parent: string;
  child: string;
  winner: EdgeProvenance;
  loser: EdgeProvenance;
};

export type MergeResult = {
  edges: CompositionEdge[];
  conflicts: EdgeConflict[];
};

/**
 * Union all edges, resolving conflicts by provenance rank. A conflict is two
 * edges that share `parent::child` but disagree on existence-detail (here:
 * slot placement). The higher-ranked edge wins; the loser is recorded (never
 * silently dropped) so the review UI can surface it. Identical edges (same
 * parent/child/slot) collapse to the highest-ranked copy with no conflict.
 */
export function mergeEdges(all: CompositionEdge[]): MergeResult {
  const byKey = new Map<string, CompositionEdge>();
  const conflicts: EdgeConflict[] = [];

  for (const edge of all) {
    const key = `${edge.parent}::${edge.child}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, edge);
      continue;
    }

    const sameSlot = (existing.slot ?? '') === (edge.slot ?? '');
    if (sameSlot) {
      // Identical relationship — keep the higher-ranked provenance, no conflict.
      if (rank(edge.provenance) < rank(existing.provenance)) byKey.set(key, edge);
      continue;
    }

    // Slot placement disagreement → conflict. Higher rank wins.
    const winnerEdge = rank(edge.provenance) < rank(existing.provenance) ? edge : existing;
    const loserEdge = winnerEdge === edge ? existing : edge;
    byKey.set(key, winnerEdge);
    conflicts.push({
      parent: edge.parent,
      child: edge.child,
      winner: winnerEdge.provenance,
      loser: loserEdge.provenance,
    });
  }

  return { edges: [...byKey.values()], conflicts };
}
