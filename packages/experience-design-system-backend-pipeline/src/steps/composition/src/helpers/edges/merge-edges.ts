import type { CompositionEdge, EdgeProvenance } from './interchange-schema.js';

function rank(p: EdgeProvenance): number {
  if (p === 'typed-slot') return 1;
  if (p === 'structural') return 2;
  if (p === 'manifest') return 3;
  if (p === 'doc') return 4;
  if (p.startsWith('adapter:')) return 5;
  return 6; // agent
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
      if (rank(edge.provenance) < rank(existing.provenance)) byKey.set(key, edge);
      continue;
    }

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
