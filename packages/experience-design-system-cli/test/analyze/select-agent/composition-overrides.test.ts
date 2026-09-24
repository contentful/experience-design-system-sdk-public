import { describe, it, expect } from 'vitest';
import {
  overrideRejectionsForCompositionDependencies,
  type SelectionDecision,
} from '../../../src/analyze/select-agent/composition-overrides.js';
import type { RawComponentDefinition } from '../../../src/types.js';

type TestComponent = Pick<RawComponentDefinition, 'name' | 'slots'>;

const keyFor = (component: TestComponent): string => component.name;

function component(name: string, allowedComponents: string[] = []): TestComponent {
  return {
    name,
    slots: allowedComponents.length > 0 ? [{ name: 'children', isDefault: true, allowedComponents }] : [],
  };
}

describe('overrideRejectionsForCompositionDependencies', () => {
  it('force-accepts a rejected component referenced by an accepted component slot', () => {
    const components = [component('IconButton', ['Icon']), component('Icon')];
    const decisions = new Map<string, SelectionDecision>([
      ['IconButton', 'accepted'],
      ['Icon', 'rejected'],
    ]);

    const overridden = overrideRejectionsForCompositionDependencies(components, decisions, keyFor);
    expect(overridden.get('Icon')).toBe('Icon');
  });

  it('is a no-op when the referenced component is already accepted', () => {
    const components = [component('IconButton', ['Icon']), component('Icon')];
    const decisions = new Map<string, SelectionDecision>([
      ['IconButton', 'accepted'],
      ['Icon', 'accepted'],
    ]);

    expect(overrideRejectionsForCompositionDependencies(components, decisions, keyFor).size).toBe(0);
  });

  it('is a no-op when the referencing component is not accepted', () => {
    const components = [component('IconButton', ['Icon']), component('Icon')];
    const decisions = new Map<string, SelectionDecision>([
      ['IconButton', 'rejected'],
      ['Icon', 'rejected'],
    ]);

    expect(overrideRejectionsForCompositionDependencies(components, decisions, keyFor).size).toBe(0);
  });

  it('does not override a reference to a name absent from this session', () => {
    const components = [component('IconButton', ['Icon'])];
    const decisions = new Map<string, SelectionDecision>([['IconButton', 'accepted']]);

    expect(overrideRejectionsForCompositionDependencies(components, decisions, keyFor).size).toBe(0);
  });

  it('propagates transitively through a chain of dependencies', () => {
    const components = [component('Card', ['IconButton']), component('IconButton', ['Icon']), component('Icon')];
    const decisions = new Map<string, SelectionDecision>([
      ['Card', 'accepted'],
      ['IconButton', 'rejected'],
      ['Icon', 'rejected'],
    ]);

    const overridden = overrideRejectionsForCompositionDependencies(components, decisions, keyFor);
    expect(overridden.get('IconButton')).toBe('IconButton');
    expect(overridden.get('Icon')).toBe('Icon');
  });

  it('handles a component with no decision entry (treated as not accepted)', () => {
    const components = [component('IconButton', ['Icon']), component('Icon')];
    const decisions = new Map<string, SelectionDecision>();

    expect(overrideRejectionsForCompositionDependencies(components, decisions, keyFor).size).toBe(0);
  });
});
