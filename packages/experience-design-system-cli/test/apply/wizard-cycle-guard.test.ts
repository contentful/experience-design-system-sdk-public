import { describe, it, expect } from 'vitest';
import { buildManifest } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { detectSlotCycles, extractComponentsFromManifest } from '../../src/apply/command.js';

describe('wizard push guard — detectSlotCycles ∘ extractComponentsFromManifest', () => {
  it('surfaces a 2-cycle built into a real ManifestPayload', () => {
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
    const manifest = buildManifest(components, []);
    const extracted = extractComponentsFromManifest(manifest);
    const cycles = detectSlotCycles(extracted);

    expect(extracted.map((c) => c.key).sort()).toEqual(['CycleA', 'CycleB']);
    expect(cycles.length).toBeGreaterThan(0);
    const names = new Set(cycles.flatMap((c) => c.path));
    expect(names.has('CycleA')).toBe(true);
    expect(names.has('CycleB')).toBe(true);
  });

  it('returns no cycles for an acyclic manifest', () => {
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
    const manifest = buildManifest(components, []);
    const cycles = detectSlotCycles(extractComponentsFromManifest(manifest));
    expect(cycles).toEqual([]);
  });

  it('skips the $schema sentinel when extracting from a manifest', () => {
    const manifest = buildManifest(
      [
        {
          key: 'Foo',
          entry: { $type: 'component', $properties: {} },
        },
      ],
      [],
    );
    const extracted = extractComponentsFromManifest(manifest);
    expect(extracted.map((c) => c.key)).toEqual(['Foo']);
  });

  it('is safe on empty / undefined manifests', () => {
    expect(extractComponentsFromManifest(null)).toEqual([]);
    expect(extractComponentsFromManifest(undefined)).toEqual([]);
    expect(extractComponentsFromManifest({})).toEqual([]);
    expect(extractComponentsFromManifest({ componentsManifest: {} })).toEqual([]);
  });
});
