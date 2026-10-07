import { describe, expect, it } from 'vitest';
import { mergeEdges } from '../../helpers/merge-edges.js';

describe('mergeEdges', () => {
  it('returns empty result for no edges', () => {
    expect(mergeEdges([])).toEqual({ edges: [], conflicts: [] });
  });

  it('keeps all unique parent/child pairs without conflict', () => {
    const result = mergeEdges([
      { parent: 'A', child: 'B', provenance: 'typed-slot' },
      { parent: 'A', child: 'C', provenance: 'agent' },
    ]);
    expect(result.edges).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  it('keeps higher-ranked edge when same parent/child/slot appear twice', () => {
    const result = mergeEdges([
      { parent: 'A', child: 'B', slot: 'content', provenance: 'agent' },
      { parent: 'A', child: 'B', slot: 'content', provenance: 'typed-slot' },
    ]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.provenance).toBe('typed-slot');
    expect(result.conflicts).toHaveLength(0);
  });

  it('records conflict and keeps higher-ranked edge when same pair has different slots', () => {
    const result = mergeEdges([
      { parent: 'A', child: 'B', slot: 'header', provenance: 'agent' },
      { parent: 'A', child: 'B', slot: 'footer', provenance: 'structural' },
    ]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.provenance).toBe('structural');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ parent: 'A', child: 'B', winner: 'structural', loser: 'agent' });
  });

  it('preserves existing edge when incoming rank is lower', () => {
    const result = mergeEdges([
      { parent: 'A', child: 'B', provenance: 'typed-slot' },
      { parent: 'A', child: 'B', provenance: 'agent' },
    ]);
    expect(result.edges[0]!.provenance).toBe('typed-slot');
  });

  it('ranks typed-slot > structural > manifest > doc > adapter > agent', () => {
    const provenances = ['agent', 'adapter:react', 'doc', 'manifest', 'structural', 'typed-slot'] as const;
    const edges = provenances.map((provenance) => ({ parent: 'A', child: 'B', provenance }));
    const { edges: merged } = mergeEdges(edges);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.provenance).toBe('typed-slot');
  });

  it('treats two edges with no slot as same slot (no conflict)', () => {
    const result = mergeEdges([
      { parent: 'A', child: 'B', provenance: 'agent' },
      { parent: 'A', child: 'B', provenance: 'structural' },
    ]);
    expect(result.edges).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
    expect(result.edges[0]!.provenance).toBe('structural');
  });
});
