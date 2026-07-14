import { describe, it, expect } from 'vitest';
import {
  findDirectParents,
  findAllAncestors,
  findAllAncestorChains,
  buildAncestorTree,
  renderAncestorTree,
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
    const components = [
      comp('A', [['s', ['B']]]),
      comp('B', [['s', ['A']]]),
    ];
    const chains = findAllAncestorChains('A', components);
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      const nodes = new Set<string>();
      nodes.add(chain[0].from);
      for (const edge of chain) nodes.add(edge.to);
      expect(nodes.size).toBe(chain.length + 1);
    }
  });
});

describe('buildAncestorTree', () => {
  it('single direct parent → root with one non-shared, non-cycle child', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card')];
    const tree = buildAncestorTree('Card', components);
    expect(tree.name).toBe('Card');
    expect(tree.depth).toBe(0);
    expect(tree.parents).toHaveLength(1);
    const p = tree.parents[0];
    expect(p.name).toBe('Article');
    expect(p.incomingSlotName).toBe('body');
    expect(p.depth).toBe(1);
    expect(p.shared).toBe(false);
    expect(p.cycle).toBe(false);
    expect(p.parents).toEqual([]);
  });

  it('two independent parents → root has 2 leaves', () => {
    const components = [
      comp('Article', [['body', ['Card']]]),
      comp('Page', [['hero', ['Card']]]),
      comp('Card'),
    ];
    const tree = buildAncestorTree('Card', components);
    expect(tree.parents.map((p) => p.name)).toEqual(['Article', 'Page']);
    for (const p of tree.parents) {
      expect(p.parents).toEqual([]);
      expect(p.shared).toBe(false);
      expect(p.cycle).toBe(false);
    }
  });

  it('multi-hop chain (Landing → Section → Card)', () => {
    const components = [
      comp('Landing', [['sections', ['Section']]]),
      comp('Section', [['items', ['Card']]]),
      comp('Card'),
    ];
    const tree = buildAncestorTree('Card', components);
    expect(tree.parents).toHaveLength(1);
    const section = tree.parents[0];
    expect(section.name).toBe('Section');
    expect(section.incomingSlotName).toBe('items');
    expect(section.parents).toHaveLength(1);
    const landing = section.parents[0];
    expect(landing.name).toBe('Landing');
    expect(landing.incomingSlotName).toBe('sections');
    expect(landing.depth).toBe(2);
    expect(landing.parents).toEqual([]);
  });

  it('shared ancestor → second occurrence marked shared with no parents', () => {
    const components = [
      comp('Foo', [
        ['sA', ['A']],
        ['sB', ['B']],
      ]),
      comp('A', [['s', ['X']]]),
      comp('B', [['s', ['X']]]),
      comp('X'),
    ];
    const tree = buildAncestorTree('X', components);
    expect(tree.parents.map((p) => p.name)).toEqual(['A', 'B']);
    const a = tree.parents[0];
    const b = tree.parents[1];
    expect(a.parents).toHaveLength(1);
    expect(a.parents[0].name).toBe('Foo');
    expect(a.parents[0].shared).toBe(false);
    expect(b.parents).toHaveLength(1);
    expect(b.parents[0].name).toBe('Foo');
    expect(b.parents[0].shared).toBe(true);
    expect(b.parents[0].parents).toEqual([]);
  });

  it('cycle (A ↔ B, target = A)', () => {
    const components = [
      comp('A', [['s', ['B']]]),
      comp('B', [['s', ['A']]]),
    ];
    const tree = buildAncestorTree('A', components);
    expect(tree.parents).toHaveLength(1);
    const b = tree.parents[0];
    expect(b.name).toBe('B');
    expect(b.parents).toHaveLength(1);
    const aBack = b.parents[0];
    expect(aBack.name).toBe('A');
    expect(aBack.cycle).toBe(true);
    expect(aBack.shared).toBe(false);
    expect(aBack.parents).toEqual([]);
  });
});

describe('renderAncestorTree', () => {
  it('leaf case renders 2 lines', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card')];
    const lines = renderAncestorTree(buildAncestorTree('Card', components));
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Card');
    expect(lines[0].jumpTarget).toBe('Card');
    expect(lines[1].text).toBe('└─ [body] ← Article');
    expect(lines[1].jumpTarget).toBe('Article');
    expect(lines[1].depth).toBe(1);
  });

  it('3-generation chain renders 3 lines with correct indentation', () => {
    const components = [
      comp('Landing', [['sections', ['Section']]]),
      comp('Section', [['items', ['Card']]]),
      comp('Card'),
    ];
    const lines = renderAncestorTree(buildAncestorTree('Card', components));
    expect(lines.map((l) => l.text)).toEqual([
      'Card',
      '└─ [items] ← Section',
      '   └─ [sections] ← Landing',
    ]);
  });

  it('shared node label contains (shared)', () => {
    const components = [
      comp('Foo', [
        ['sA', ['A']],
        ['sB', ['B']],
      ]),
      comp('A', [['s', ['X']]]),
      comp('B', [['s', ['X']]]),
      comp('X'),
    ];
    const lines = renderAncestorTree(buildAncestorTree('X', components));
    const sharedLine = lines.find((l) => l.text.includes('(shared)'));
    expect(sharedLine).toBeDefined();
    expect(sharedLine!.jumpTarget).toBe('Foo');
  });

  it('cycle node label contains (cycle ↺)', () => {
    const components = [
      comp('A', [['s', ['B']]]),
      comp('B', [['s', ['A']]]),
    ];
    const lines = renderAncestorTree(buildAncestorTree('A', components));
    const cycleLine = lines.find((l) => l.text.includes('(cycle ↺)'));
    expect(cycleLine).toBeDefined();
    expect(cycleLine!.jumpTarget).toBe('A');
  });
});
