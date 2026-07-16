import { describe, it, expect } from 'vitest';
import { componentsToInterchangeMap } from '../../../src/analyze/command.js';
import type { RawSlotDefinition } from '../../../src/types.js';

function comp(name: string, slots: RawSlotDefinition[]) {
  return { name, slots };
}
const slot = (name: string, allowed?: string[]): RawSlotDefinition => ({
  name,
  isDefault: name === 'children',
  ...(allowed ? { allowedComponents: allowed } : {}),
});

describe('componentsToInterchangeMap (--generate-map skeleton)', () => {
  it('captures typed-slot allowedComponents as parent→children groups', () => {
    const map = componentsToInterchangeMap([
      comp('Page', [slot('hero', ['Hero']), slot('main', ['Section'])]),
      comp('Section', [slot('body', ['Card', 'Text'])]),
      comp('Hero', []),
    ]);
    expect(map.version).toBe(1);
    expect(map.groups.Page).toEqual(['Hero', 'Section']);
    expect(map.groups.Section).toEqual(['Card', 'Text']);
  });

  it('omits components with no allowed children', () => {
    const map = componentsToInterchangeMap([comp('Leaf', [slot('children')]), comp('Bare', [])]);
    expect(map.groups.Leaf).toBeUndefined();
    expect(map.groups.Bare).toBeUndefined();
    expect(Object.keys(map.groups)).toHaveLength(0);
  });

  it('dedupes and sorts children across multiple slots', () => {
    const map = componentsToInterchangeMap([comp('A', [slot('x', ['C', 'B']), slot('y', ['B'])])]);
    expect(map.groups.A).toEqual(['B', 'C']);
  });

  it('sorts parents deterministically', () => {
    const map = componentsToInterchangeMap([comp('Zeta', [slot('s', ['X'])]), comp('Alpha', [slot('s', ['Y'])])]);
    expect(Object.keys(map.groups)).toEqual(['Alpha', 'Zeta']);
  });

  it('preserves cyclic edges (they are valid composition data)', () => {
    const map = componentsToInterchangeMap([
      comp('NodeA', [slot('slot', ['NodeB'])]),
      comp('NodeB', [slot('slot', ['NodeA'])]),
    ]);
    expect(map.groups.NodeA).toEqual(['NodeB']);
    expect(map.groups.NodeB).toEqual(['NodeA']);
  });
});
