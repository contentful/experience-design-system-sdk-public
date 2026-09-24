import { describe, it, expect } from 'vitest';
import { buildCDF } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { detectSlotCycles, extractComponents } from '../../src/apply/command.js';

describe('wizard push guard — detectSlotCycles ∘ extractComponents', () => {
  it('surfaces a 2-cycle built into a real CDF document', () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'CycleA',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { header: { $allowedComponents: ['CycleB'] } },
        },
      },
      {
        key: 'CycleB',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { footer: { $allowedComponents: ['CycleA'] } },
        },
      },
    ];
    const cdf = buildCDF(components, [])!;
    const extracted = extractComponents(cdf);
    const cycles = detectSlotCycles(extracted);

    expect(extracted.map((c) => c.key).sort()).toEqual(['CycleA', 'CycleB']);
    expect(cycles.length).toBeGreaterThan(0);
    const names = new Set(cycles.flatMap((c) => c.path));
    expect(names.has('CycleA')).toBe(true);
    expect(names.has('CycleB')).toBe(true);
  });

  it('returns no cycles for an acyclic document', () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'Card',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { header: { $allowedComponents: ['Heading'] } },
        },
      },
      { key: 'Heading', entry: { $type: 'component', $properties: {} } },
    ];
    const cdf = buildCDF(components, [])!;
    const cycles = detectSlotCycles(extractComponents(cdf));
    expect(cycles).toEqual([]);
  });

  it('skips the $schema sentinel when extracting from a document', () => {
    const cdf = buildCDF(
      [
        {
          key: 'Foo',
          entry: { $type: 'component', $properties: {} },
        },
      ],
      [],
    )!;
    const extracted = extractComponents(cdf);
    expect(extracted.map((c) => c.key)).toEqual(['Foo']);
  });

  it('is safe on empty / undefined documents', () => {
    expect(extractComponents(null)).toEqual([]);
    expect(extractComponents(undefined)).toEqual([]);
    expect(extractComponents({})).toEqual([]);
    expect(extractComponents({ $schema: 'https://contentful.com/schemas/cdf' })).toEqual([]);
  });
});
