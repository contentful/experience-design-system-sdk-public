import { describe, it, expect } from 'vitest';
import { applyMapping, type ApplyMappingResult } from '../../../src/analyze/composition/apply-mapping.js';
import type { CompositionEdge } from '../../../src/analyze/composition/interchange-schema.js';
import type { RawComponentDefinition, RawSlotDefinition } from '../../../src/types.js';

function comp(name: string, slots: RawSlotDefinition[] = []): RawComponentDefinition {
  return { name, source: '', framework: 'react', props: [], slots };
}
function slot(name: string, isDefault: boolean, allowed?: string[]): RawSlotDefinition {
  return { name, isDefault, ...(allowed ? { allowedComponents: allowed } : {}) };
}
const edge = (
  parent: string,
  child: string,
  provenance: CompositionEdge['provenance'],
  s?: string,
): CompositionEdge => ({
  parent,
  child,
  provenance,
  ...(s ? { slot: s } : {}),
});

describe('applyMapping (T7 — enrichment pass)', () => {
  it('writes children onto the default slot when edge has no slot', () => {
    const components = [comp('A', [slot('children', true)]), comp('B')];
    const res = applyMapping(components, [edge('A', 'B', 'typed-slot')]);
    const a = res.components.find((c) => c.name === 'A')!;
    expect(a.slots.find((s) => s.isDefault)!.allowedComponents).toEqual(['B']);
  });

  it('writes onto a named slot when edge.slot matches an existing slot', () => {
    const components = [comp('A', [slot('header', false), slot('children', true)]), comp('B')];
    const res = applyMapping(components, [edge('A', 'B', 'user', 'header')]);
    const a = res.components.find((c) => c.name === 'A')!;
    expect(a.slots.find((s) => s.name === 'header')!.allowedComponents).toEqual(['B']);
    expect(a.slots.find((s) => s.isDefault)!.allowedComponents ?? []).toEqual([]);
  });

  it('synthesizes a default slot when the parent has none', () => {
    const components = [comp('A'), comp('B')];
    const res = applyMapping(components, [edge('A', 'B', 'typed-slot')]);
    const a = res.components.find((c) => c.name === 'A')!;
    expect(a.slots.length).toBe(1);
    expect(a.slots[0].isDefault).toBe(true);
    expect(a.slots[0].allowedComponents).toEqual(['B']);
  });

  it('merges (unions) with pre-existing allowedComponents without duplicates', () => {
    const components = [comp('A', [slot('children', true, ['X'])]), comp('B')];
    const res = applyMapping(components, [edge('A', 'B', 'agent'), edge('A', 'X', 'agent')]);
    const a = res.components.find((c) => c.name === 'A')!;
    expect(a.slots.find((s) => s.isDefault)!.allowedComponents!.sort()).toEqual(['B', 'X']);
  });

  it('drops an edge whose parent is not an extracted component (warn)', () => {
    const components = [comp('A', [slot('children', true)])];
    const res: ApplyMappingResult = applyMapping(components, [edge('GHOST', 'A', 'agent')]);
    expect(res.warnings.join(' ')).toMatch(/GHOST/);
    // A untouched
    expect(res.components.find((c) => c.name === 'A')!.slots[0].allowedComponents ?? []).toEqual([]);
  });

  it('drops an edge whose child is not an extracted component (warn)', () => {
    const components = [comp('A', [slot('children', true)])];
    const res = applyMapping(components, [edge('A', 'GHOST', 'agent')]);
    expect(res.warnings.join(' ')).toMatch(/GHOST/);
    expect(res.components.find((c) => c.name === 'A')!.slots[0].allowedComponents ?? []).toEqual([]);
  });

  it('T7 edge case: agent edge naming a nonexistent slot is dropped-and-warned; typed-slot synthesizes', () => {
    const components = [comp('A', [slot('children', true)]), comp('B')];
    const agentRes = applyMapping(components, [edge('A', 'B', 'agent', 'ghostSlot')]);
    expect(agentRes.warnings.join(' ')).toMatch(/ghostSlot/i);
    expect(agentRes.components.find((c) => c.name === 'A')!.slots.find((s) => s.name === 'ghostSlot')).toBeUndefined();

    const typedRes = applyMapping(
      [comp('A', [slot('children', true)]), comp('B')],
      [edge('A', 'B', 'typed-slot', 'ghostSlot')],
    );
    const a = typedRes.components.find((c) => c.name === 'A')!;
    expect(a.slots.find((s) => s.name === 'ghostSlot')!.allowedComponents).toEqual(['B']);
  });

  it('does not mutate the input components', () => {
    const components = [comp('A', [slot('children', true)]), comp('B')];
    applyMapping(components, [edge('A', 'B', 'user')]);
    expect(components.find((c) => c.name === 'A')!.slots[0].allowedComponents).toBeUndefined();
  });
});
