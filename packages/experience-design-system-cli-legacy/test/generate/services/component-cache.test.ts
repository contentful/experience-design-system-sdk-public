import { describe, it, expect } from 'vitest';
import { normalizeComponentForCache } from '../../../src/generate/services/component-cache.js';

const baseComponent = {
  component_id: 'comp1',
  name: 'Button',
  source: 'src/Button.tsx',
  framework: 'react' as const,
  props: [],
  slots: [],
};

describe('normalizeComponentForCache', () => {
  it('leaves named slots unchanged', () => {
    const comp = { ...baseComponent, slots: [{ name: 'children', isDefault: false, allowedComponents: [] }] };
    const result = normalizeComponentForCache(comp);
    expect(result.slots[0]!.name).toBe('children');
  });

  it('renames a single empty-named slot to "children"', () => {
    const comp = { ...baseComponent, slots: [{ name: '', isDefault: false, allowedComponents: [] }] };
    const result = normalizeComponentForCache(comp);
    expect(result.slots[0]!.name).toBe('children');
  });

  it('renames multiple empty-named slots to slot_0, slot_1 etc', () => {
    const comp = {
      ...baseComponent,
      slots: [
        { name: '', isDefault: false, allowedComponents: [] },
        { name: '', isDefault: false, allowedComponents: [] },
      ],
    };
    const result = normalizeComponentForCache(comp);
    expect(result.slots[0]!.name).toBe('slot_0');
    expect(result.slots[1]!.name).toBe('slot_1');
  });

  it('trims whitespace from slot names', () => {
    const comp = { ...baseComponent, slots: [{ name: '  main  ', isDefault: false, allowedComponents: [] }] };
    const result = normalizeComponentForCache(comp);
    expect(result.slots[0]!.name).toBe('main');
  });

  it('does not mutate the original component', () => {
    const slots = [{ name: '', isDefault: false, allowedComponents: [] }];
    const comp = { ...baseComponent, slots };
    normalizeComponentForCache(comp);
    expect(slots[0]!.name).toBe('');
  });
});
