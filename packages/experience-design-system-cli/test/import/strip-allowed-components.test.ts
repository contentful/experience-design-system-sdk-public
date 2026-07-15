import { describe, it, expect } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { stripAllowedComponents } from '../../src/import/strip-allowed-components.js';

function comp(entry: CDFComponentEntry): { key: string; entry: CDFComponentEntry } {
  return { key: 'X', entry };
}

describe('stripAllowedComponents (atomic mode)', () => {
  it('removes $allowedComponents but keeps the slot structure', () => {
    const input = [
      comp({
        $type: 'component',
        $properties: {},
        $slots: {
          children: { $allowedComponents: ['B', 'C'], $description: 'kids' },
        },
      }),
    ];
    const out = stripAllowedComponents(input);
    expect(out[0].entry.$slots).toBeDefined();
    expect(out[0].entry.$slots!.children).toBeDefined();
    // slot survives, but the composition constraint is gone
    expect(out[0].entry.$slots!.children.$allowedComponents).toBeUndefined();
    // other slot metadata is preserved
    expect(out[0].entry.$slots!.children.$description).toBe('kids');
  });

  it('leaves components without slots untouched', () => {
    const input = [comp({ $type: 'component', $properties: {} })];
    const out = stripAllowedComponents(input);
    expect(out[0].entry.$slots).toBeUndefined();
    expect(out[0].entry.$properties).toBeDefined();
  });

  it('strips across multiple slots and components', () => {
    const input = [
      comp({
        $type: 'component',
        $properties: {},
        $slots: {
          a: { $allowedComponents: ['P'] },
          b: { $allowedComponents: ['Q'], $required: true },
        },
      }),
    ];
    const out = stripAllowedComponents(input);
    expect(out[0].entry.$slots!.a.$allowedComponents).toBeUndefined();
    expect(out[0].entry.$slots!.b.$allowedComponents).toBeUndefined();
    expect(out[0].entry.$slots!.b.$required).toBe(true);
  });

  it('does not mutate the input entries', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {},
      $slots: { children: { $allowedComponents: ['B'] } },
    };
    const input = [{ key: 'X', entry }];
    stripAllowedComponents(input);
    expect(entry.$slots!.children.$allowedComponents).toEqual(['B']);
  });

  it('yields zero cycles when fed to slot-cycle detection', () => {
    // A→B→A becomes flat once stripped.
    const input = [comp({ $type: 'component', $properties: {}, $slots: { s: { $allowedComponents: ['Y'] } } })];
    const out = stripAllowedComponents(input);
    const anyAllowed = out.some(({ entry }) =>
      Object.values(entry.$slots ?? {}).some((s) => (s.$allowedComponents?.length ?? 0) > 0),
    );
    expect(anyAllowed).toBe(false);
  });
});
