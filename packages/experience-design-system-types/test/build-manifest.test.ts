import { describe, it, expect } from 'vitest';
import { buildManifest } from '../src/sources-api/manifest/utils.js';
import type { CDFComponentEntry } from '../src/cdf/index.js';

const CARD: { key: string; entry: CDFComponentEntry } = {
  key: 'Card',
  entry: { $type: 'component', $properties: {} },
};

describe('buildManifest — componentsManifest presence', () => {
  it('includes componentsManifest when there are components', () => {
    const m = buildManifest([CARD], []);
    expect(m.componentsManifest).toBeDefined();
    expect(m.componentsManifest?.Card).toBeDefined();
  });

  it('OMITS componentsManifest for an empty list by default (no-op, not delete-all)', () => {
    const m = buildManifest([], []);
    expect(m.componentsManifest).toBeUndefined();
  });

  it('emits an empty-but-present componentsManifest with deleteAllComponents (server diffs as remove-all)', () => {
    const m = buildManifest([], [], { deleteAllComponents: true });
    expect(m.componentsManifest).toBeDefined();
    // Present with only $schema, zero component entries.
    const keys = Object.keys(m.componentsManifest ?? {}).filter((k) => k !== '$schema');
    expect(keys).toEqual([]);
    expect((m.componentsManifest as Record<string, unknown>)?.['$schema']).toBeTruthy();
  });

  it('deleteAllComponents is a no-op when components are present (they still ship)', () => {
    const m = buildManifest([CARD], [], { deleteAllComponents: true });
    expect(m.componentsManifest?.Card).toBeDefined();
  });
});
