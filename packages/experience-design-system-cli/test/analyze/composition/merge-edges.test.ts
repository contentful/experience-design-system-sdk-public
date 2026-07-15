import { describe, it, expect } from 'vitest';
import { mergeEdges, type MergeResult } from '../../../src/analyze/composition/merge-edges.js';
import type { CompositionEdge } from '../../../src/analyze/composition/interchange-schema.js';

const e = (
  parent: string,
  child: string,
  provenance: CompositionEdge['provenance'],
  slot?: string,
): CompositionEdge => ({
  parent,
  child,
  provenance,
  ...(slot ? { slot } : {}),
});

describe('mergeEdges (T2 — union, rank-resolve conflicts)', () => {
  it('unions disjoint edges from multiple sources', () => {
    const res = mergeEdges([e('A', 'B', 'typed-slot'), e('C', 'D', 'agent')]);
    expect(res.edges).toHaveLength(2);
  });

  it('dedupes an identical edge present in two sources, keeping the higher rank', () => {
    const res = mergeEdges([e('A', 'B', 'agent'), e('A', 'B', 'typed-slot')]);
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0].provenance).toBe('typed-slot');
  });

  it('user map wins over typed-slot on the same edge', () => {
    const res = mergeEdges([e('A', 'B', 'typed-slot'), e('A', 'B', 'user')]);
    expect(res.edges[0].provenance).toBe('user');
  });

  it('typed-slot wins over adapter, adapter wins over agent', () => {
    expect(mergeEdges([e('A', 'B', 'adapter:x'), e('A', 'B', 'typed-slot')]).edges[0].provenance).toBe('typed-slot');
    expect(mergeEdges([e('A', 'B', 'agent'), e('A', 'B', 'adapter:x')]).edges[0].provenance).toBe('adapter:x');
  });

  it('does NOT flag a conflict when two sources agree on the same edge (default slot)', () => {
    // Same parent/child/slot from different sources is agreement, not conflict
    // (spec T2: a conflict is disagreement on existence or slot placement).
    const res: MergeResult = mergeEdges([e('A', 'B', 'agent'), e('A', 'B', 'user')]);
    expect(res.conflicts).toHaveLength(0);
    expect(res.edges[0].provenance).toBe('user');
  });

  it('records the losing provenance of a slot-placement conflict for review', () => {
    const res: MergeResult = mergeEdges([e('A', 'B', 'agent', 'footer'), e('A', 'B', 'user', 'header')]);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ parent: 'A', child: 'B', winner: 'user', loser: 'agent' });
  });

  it('treats a different slot on the same parent/child as a conflict, higher rank wins', () => {
    const res = mergeEdges([e('A', 'B', 'agent', 'footer'), e('A', 'B', 'typed-slot', 'header')]);
    expect(res.edges).toHaveLength(1);
    expect(res.edges[0].slot).toBe('header');
    expect(res.conflicts).toHaveLength(1);
  });

  it('keeps edges with the same parent/child but treats them as one when slot matches', () => {
    const res = mergeEdges([e('A', 'B', 'agent', 'header'), e('A', 'B', 'typed-slot', 'header')]);
    expect(res.edges).toHaveLength(1);
    expect(res.conflicts).toHaveLength(0);
    expect(res.edges[0].provenance).toBe('typed-slot');
  });

  it('all four sources: rank 1>2>3>4 resolves; union otherwise', () => {
    const res = mergeEdges([
      e('A', 'B', 'agent'),
      e('A', 'B', 'user'),
      e('A', 'B', 'adapter:x'),
      e('A', 'B', 'typed-slot'),
      e('X', 'Y', 'agent'),
    ]);
    const ab = res.edges.find((x) => x.parent === 'A' && x.child === 'B');
    expect(ab?.provenance).toBe('user');
    expect(res.edges.find((x) => x.parent === 'X')).toBeTruthy();
  });
});
