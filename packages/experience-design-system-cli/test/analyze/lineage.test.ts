import { describe, it, expect } from 'vitest';
import {
  findDirectParents,
  findAllAncestors,
  findAllAncestorChains,
  type LineageEdge,
} from '../../src/analyze/lineage.js';
import type { ComponentGraphNode } from '../../src/analyze/composite-closure.js';

function comp(name: string, slots: Array<[string, string[]]> = []): ComponentGraphNode {
  return {
    name,
    slots: slots.map(([slotName, allowed]) => ({ name: slotName, allowedComponents: allowed })),
  };
}

describe('findDirectParents', () => {
  it('returns empty when nothing slots the target', () => {
    const components = [comp('A'), comp('B')];
    expect(findDirectParents('A', components)).toEqual([]);
  });

  it('returns the single parent that slots the target', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card')];
    expect(findDirectParents('Card', components)).toEqual([
      { parent: 'Article', slotName: 'body' },
    ]);
  });

  it('returns every parent (shared dep case), sorted by parent then slot', () => {
    const components = [
      comp('Page', [['hero', ['Card']]]),
      comp('Article', [['body', ['Card']]]),
      comp('Card'),
    ];
    expect(findDirectParents('Card', components)).toEqual([
      { parent: 'Article', slotName: 'body' },
      { parent: 'Page', slotName: 'hero' },
    ]);
  });

  it('returns one entry per (parent, slot) — same slot listing target twice is deduped', () => {
    const components = [
      comp('Article', [['body', ['Card', 'Card']]]),
      comp('Card'),
    ];
    expect(findDirectParents('Card', components)).toEqual([
      { parent: 'Article', slotName: 'body' },
    ]);
  });

  it('returns two entries when one parent slots the same target in two different slots', () => {
    const components = [
      comp('Article', [
        ['body', ['Card']],
        ['sidebar', ['Card']],
      ]),
      comp('Card'),
    ];
    expect(findDirectParents('Card', components)).toEqual([
      { parent: 'Article', slotName: 'body' },
      { parent: 'Article', slotName: 'sidebar' },
    ]);
  });

  it('ignores self-references', () => {
    const components = [comp('A', [['slot', ['A']]])];
    expect(findDirectParents('A', components)).toEqual([]);
  });
});

describe('findAllAncestors', () => {
  it('returns empty set for a root', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B')];
    expect([...findAllAncestors('A', components)]).toEqual([]);
  });

  it('returns transitive ancestors', () => {
    // Landing → Section → Card. Card's ancestors = { Section, Landing }.
    const components = [
      comp('Landing', [['sections', ['Section']]]),
      comp('Section', [['items', ['Card']]]),
      comp('Card'),
    ];
    expect([...findAllAncestors('Card', components)].sort()).toEqual(['Landing', 'Section']);
  });

  it('returns every ancestor for a shared dep', () => {
    const components = [
      comp('Article', [['body', ['Card']]]),
      comp('Page', [['hero', ['Card']]]),
      comp('Card'),
    ];
    expect([...findAllAncestors('Card', components)].sort()).toEqual(['Article', 'Page']);
  });

  it('handles cycles without infinite loop', () => {
    // A → B, B → A. Both are ancestors of each other.
    const components = [
      comp('A', [['s', ['B']]]),
      comp('B', [['s', ['A']]]),
    ];
    expect([...findAllAncestors('A', components)].sort()).toEqual(['B']);
    expect([...findAllAncestors('B', components)].sort()).toEqual(['A']);
  });
});

describe('findAllAncestorChains', () => {
  it('returns empty when target has no parents', () => {
    const components = [comp('A')];
    expect(findAllAncestorChains('A', components)).toEqual([]);
  });

  it('returns a single-edge chain for a direct parent', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card')];
    const chains = findAllAncestorChains('Card', components);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual([{ from: 'Article', slotName: 'body', to: 'Card' }] as LineageEdge[]);
  });

  it('returns multiple chains when parents diverge', () => {
    const components = [
      comp('Article', [['body', ['Card']]]),
      comp('Page', [['hero', ['Card']]]),
      comp('Card'),
    ];
    const chains = findAllAncestorChains('Card', components);
    expect(chains).toHaveLength(2);
    const asStrings = chains.map((chain) =>
      chain.map((e) => `${e.from}[${e.slotName}]→${e.to}`).join(' '),
    );
    expect(asStrings.sort()).toEqual([
      'Article[body]→Card',
      'Page[hero]→Card',
    ]);
  });

  it('extends chains through the transitive graph', () => {
    // Landing → [sections] → Section → [items] → Card.
    const components = [
      comp('Landing', [['sections', ['Section']]]),
      comp('Section', [['items', ['Card']]]),
      comp('Card'),
    ];
    const chains = findAllAncestorChains('Card', components);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual([
      { from: 'Landing', slotName: 'sections', to: 'Section' },
      { from: 'Section', slotName: 'items', to: 'Card' },
    ]);
  });

  it('terminates on cycles', () => {
    // A → B → A. findAllAncestorChains(A) should return at least one chain
    // starting at B without looping forever.
    const components = [
      comp('A', [['s', ['B']]]),
      comp('B', [['s', ['A']]]),
    ];
    const chains = findAllAncestorChains('A', components);
    expect(chains.length).toBeGreaterThan(0);
    // No chain repeats a node.
    for (const chain of chains) {
      const nodes = new Set<string>();
      nodes.add(chain[0].from);
      for (const edge of chain) nodes.add(edge.to);
      expect(nodes.size).toBe(chain.length + 1);
    }
  });
});
