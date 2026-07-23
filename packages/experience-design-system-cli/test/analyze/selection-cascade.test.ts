import { describe, it, expect } from 'vitest';
import { computeRejectCascade, computeAcceptCascade } from '../../src/analyze/selection-cascade.js';
import type { ComponentGraphNode } from '../../src/analyze/composite-closure.js';

function comp(name: string, slots: Array<[string, string[]]> = []): ComponentGraphNode {
  return {
    name,
    slots: slots.map(([slotName, allowed]) => ({ name: slotName, allowedComponents: allowed })),
  };
}

describe('computeRejectCascade', () => {
  it('returns just the target for an empty graph', () => {
    expect([...computeRejectCascade('Card', [])].sort()).toEqual(['Card']);
  });

  it('returns just the target when it has no parents', () => {
    const components = [comp('Card'), comp('Other')];
    expect([...computeRejectCascade('Card', components)].sort()).toEqual(['Card']);
  });

  it('bubbles up a simple parent chain', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card')];
    expect([...computeRejectCascade('Card', components)].sort()).toEqual(['Article', 'Card']);
  });

  it('bubbles up through diamond ancestry', () => {
    const components = [
      comp('Landing', [
        ['sections', ['Section']],
        ['hero', ['Card']],
      ]),
      comp('Section', [['items', ['Card']]]),
      comp('Card'),
    ];
    expect([...computeRejectCascade('Card', components)].sort()).toEqual(['Card', 'Landing', 'Section']);
  });

  it('bubbles up to every parent for a shared dep', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Page', [['hero', ['Card']]]), comp('Card')];
    expect([...computeRejectCascade('Card', components)].sort()).toEqual(['Article', 'Card', 'Page']);
  });

  it('terminates on cycles', () => {
    const components = [comp('A', [['s', ['B']]]), comp('B', [['s', ['A']]])];
    const result = computeRejectCascade('A', components);
    expect(result.has('A')).toBe(true);
    expect(result.has('B')).toBe(true);
  });

  it('returns just the root when a root is rejected', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card')];
    expect([...computeRejectCascade('Article', components)].sort()).toEqual(['Article']);
  });
});

describe('computeAcceptCascade', () => {
  it('returns just the target when standalone', () => {
    const components = [comp('Card')];
    expect([...computeAcceptCascade('Card', components)].sort()).toEqual(['Card']);
  });

  it('cascades down the closure when accepting a root', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card', [['icon', ['Icon']]]), comp('Icon')];
    expect([...computeAcceptCascade('Article', components)].sort()).toEqual(['Article', 'Card', 'Icon']);
  });

  it('does NOT bubble up when accepting a leaf', () => {
    const components = [comp('Article', [['body', ['Card']]]), comp('Card')];
    expect([...computeAcceptCascade('Card', components)].sort()).toEqual(['Card']);
  });
});
