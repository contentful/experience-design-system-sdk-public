import { describe, it, expect } from 'vitest';
import { detectSlotCycles, assertNoSlotCycles } from '../../src/apply/command.js';
import { stripAllowedComponents } from '../../src/import/strip-allowed-components.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

// Integration (T8/T12): the atomic strip is what starves slot-cycle detection.
// A graph that WOULD block a composite push must push cleanly once stripped —
// the slot structure survives, the composition constraint (and thus the cycle)
// does not.
describe('atomic strip → slot-cycle detection', () => {
  const cyclic: Array<{ key: string; entry: CDFComponentEntry }> = [
    {
      key: 'CycleA',
      entry: { $type: 'component', $properties: {}, $slots: { header: { $allowedComponents: ['CycleB'] } } },
    },
    {
      key: 'CycleB',
      entry: { $type: 'component', $properties: {}, $slots: { footer: { $allowedComponents: ['CycleA'] } } },
    },
  ];

  it('a cyclic composite graph is blocked before stripping', () => {
    expect(detectSlotCycles(cyclic).length).toBeGreaterThan(0);
  });

  it('the same graph has zero cycles after the atomic strip', () => {
    const stripped = stripAllowedComponents(cyclic);
    expect(detectSlotCycles(stripped)).toHaveLength(0);
    expect(() => assertNoSlotCycles(stripped)).not.toThrow();
  });

  it('preserves the slot structure while dropping the composition link', () => {
    const stripped = stripAllowedComponents(cyclic);
    expect(stripped[0].entry.$slots).toBeDefined();
    expect(stripped[0].entry.$slots!.header).toBeDefined();
    expect(stripped[0].entry.$slots!.header.$allowedComponents).toBeUndefined();
  });
});
