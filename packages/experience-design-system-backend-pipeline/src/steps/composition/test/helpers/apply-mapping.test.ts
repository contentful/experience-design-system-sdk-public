import { describe, expect, it } from 'vitest';
import { applyCompositionEdges } from '../../src/helpers/apply-mapping.js';
import type { CompositionEdge } from '../../src/helpers/interchange-schema.js';

function makeComponent(
  name: string,
  slots: Array<{ name: string; isDefault?: boolean; allowedComponents?: string[] }> = [],
) {
  return {
    name,
    source: `${name}.tsx`,
    framework: 'react' as const,
    props: [],
    slots: slots.map((s) => ({ isDefault: false, ...s })),
    extractionConfidence: 4,
    needsReview: false,
    validationIssues: [],
    reviewReasons: [],
    score: 0,
  };
}

describe('applyCompositionEdges', () => {
  it('returns cloned components unchanged when no edges are provided', () => {
    const components = [makeComponent('Button')];
    const { components: result, warnings } = applyCompositionEdges(components, []);
    expect(warnings).toHaveLength(0);
    expect(result[0]!.name).toBe('Button');
    expect(result[0]).not.toBe(components[0]);
  });

  it('adds child to named slot allowedComponents', () => {
    const components = [makeComponent('Layout', [{ name: 'content', allowedComponents: [] }]), makeComponent('Button')];
    const edges: CompositionEdge[] = [{ parent: 'Layout', child: 'Button', slot: 'content', provenance: 'agent' }];
    const { components: result, warnings } = applyCompositionEdges(components, edges);
    expect(warnings).toHaveLength(0);
    expect(result[0]!.slots[0]!.allowedComponents).toContain('Button');
  });

  it('creates a default children slot when edge has no slot and none exists', () => {
    const components = [makeComponent('Layout'), makeComponent('Button')];
    const edges: CompositionEdge[] = [{ parent: 'Layout', child: 'Button', provenance: 'agent' }];
    const { components: result } = applyCompositionEdges(components, edges);
    const defaultSlot = result[0]!.slots.find((s) => s.isDefault);
    expect(defaultSlot).toBeDefined();
    expect(defaultSlot!.name).toBe('children');
    expect(defaultSlot!.allowedComponents).toContain('Button');
  });

  it('uses existing default slot when edge has no slot', () => {
    const components = [
      makeComponent('Layout', [{ name: 'main', isDefault: true, allowedComponents: ['Card'] }]),
      makeComponent('Button'),
    ];
    const edges: CompositionEdge[] = [{ parent: 'Layout', child: 'Button', provenance: 'agent' }];
    const { components: result } = applyCompositionEdges(components, edges);
    const defaultSlot = result[0]!.slots.find((s) => s.isDefault);
    expect(defaultSlot!.allowedComponents).toEqual(expect.arrayContaining(['Card', 'Button']));
  });

  it('warns and drops edge for unknown parent', () => {
    const components = [makeComponent('Button')];
    const edges: CompositionEdge[] = [{ parent: 'Ghost', child: 'Button', provenance: 'agent' }];
    const { warnings } = applyCompositionEdges(components, edges);
    expect(warnings[0]).toContain('unknown parent "Ghost"');
  });

  it('warns and drops edge for unknown child', () => {
    const components = [makeComponent('Layout')];
    const edges: CompositionEdge[] = [{ parent: 'Layout', child: 'Ghost', provenance: 'agent' }];
    const { warnings } = applyCompositionEdges(components, edges);
    expect(warnings[0]).toContain('unknown child "Ghost"');
  });

  it('warns and drops agent-provenance edge targeting a non-existent slot', () => {
    const components = [makeComponent('Layout', [{ name: 'header' }]), makeComponent('Button')];
    const edges: CompositionEdge[] = [{ parent: 'Layout', child: 'Button', slot: 'nonexistent', provenance: 'agent' }];
    const { warnings } = applyCompositionEdges(components, edges);
    expect(warnings[0]).toContain('slot "nonexistent" not found');
  });

  it('synthesizes a new slot for typed-slot-provenance edge with non-existent slot name', () => {
    const components = [makeComponent('Layout'), makeComponent('Button')];
    const edges: CompositionEdge[] = [{ parent: 'Layout', child: 'Button', slot: 'sidebar', provenance: 'typed-slot' }];
    const { components: result, warnings } = applyCompositionEdges(components, edges);
    expect(warnings).toHaveLength(0);
    const synthesized = result[0]!.slots.find((s) => s.name === 'sidebar');
    expect(synthesized).toBeDefined();
    expect(synthesized!.allowedComponents).toContain('Button');
  });

  it('does not mutate the original input array', () => {
    const original = makeComponent('Layout', [{ name: 'content', allowedComponents: [] }]);
    const components = [original, makeComponent('Button')];
    const edges: CompositionEdge[] = [{ parent: 'Layout', child: 'Button', slot: 'content', provenance: 'agent' }];
    applyCompositionEdges(components, edges);
    expect(original.slots[0]!.allowedComponents).toHaveLength(0);
  });
});
