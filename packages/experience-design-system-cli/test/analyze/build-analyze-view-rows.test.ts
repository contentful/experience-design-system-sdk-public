import { describe, it, expect } from 'vitest';
import { buildAnalyzeViewRows } from '../../src/analyze/build-analyze-view-rows.js';
import { validateExtractedComponents } from '../../src/analyze/extract/validate.js';
import type { RawComponentDefinition } from '../../src/types.js';

describe('buildAnalyzeViewRows', () => {
  it('attaches validation errors to BOTH rows when two components share a name (positional contract)', () => {
    // P1.3 regression — Bito flagged that keying validated components by `name`
    // silently dropped errors for the first of any duplicate-named pair, since
    // `Map.set` overwrites by key. We seed two components named "Button" with
    // DIFFERENT non-duplicate validation findings (empty slot name vs.
    // prop/slot collision) so the test asserts the positional pairing
    // contract directly without depending on duplicate-name behaviour itself.
    const filteredComponents: RawComponentDefinition[] = [
      {
        name: 'Button',
        source: '/src/a/Button.tsx',
        framework: 'react',
        props: [],
        // Empty slot name → EMPTY_SLOT_NAME error.
        slots: [{ name: '', isDefault: false }],
      },
      {
        name: 'Button',
        source: '/src/b/Button.tsx',
        framework: 'react',
        // 'children' as prop AND slot → PROP_SLOT_NAME_COLLISION error.
        props: [{ name: 'children', type: 'string', required: false }],
        slots: [{ name: 'children', isDefault: true }],
      },
    ];
    const validatedComponents = validateExtractedComponents(filteredComponents);

    // Sanity: validate produced an aligned array with errors on each.
    expect(validatedComponents).toHaveLength(2);
    expect((validatedComponents[0].validationIssues ?? []).some((i) => i.code === 'EMPTY_SLOT_NAME')).toBe(true);
    expect((validatedComponents[1].validationIssues ?? []).some((i) => i.code === 'PROP_SLOT_NAME_COLLISION')).toBe(
      true,
    );

    const { rows, totalErrors } = buildAnalyzeViewRows(filteredComponents, validatedComponents, []);

    expect(rows).toHaveLength(2);
    // Each row must surface its OWN component's errors. Under a name-keyed
    // Map, both rows get the second component's errors — the first row's
    // EMPTY_SLOT_NAME is silently dropped.
    expect(rows[0].errors.some((m) => m === 'Slot at index 0 has an empty name')).toBe(true);
    expect(rows[1].errors.some((m) => m.includes('used as both a prop name and a slot name'))).toBe(true);
    // The first row must NOT carry the second component's collision error,
    // and the second row must NOT carry the first component's empty-slot error.
    expect(rows[0].errors.some((m) => m.includes('used as both a prop name and a slot name'))).toBe(false);
    expect(rows[1].errors.some((m) => m === 'Slot at index 0 has an empty name')).toBe(false);
    // Total must include errors from both rows.
    expect(totalErrors).toBe(rows[0].errors.length + rows[1].errors.length);
    expect(totalErrors).toBeGreaterThanOrEqual(2);
  });

  it('preserves input order in the output rows', () => {
    const filteredComponents: RawComponentDefinition[] = [
      {
        name: 'Alpha',
        source: '/a.tsx',
        framework: 'react',
        props: [{ name: 'x', type: 'string', required: false }],
        slots: [],
      },
      {
        name: 'Bravo',
        source: '/b.tsx',
        framework: 'react',
        props: [{ name: 'y', type: 'string', required: false }],
        slots: [],
      },
      {
        name: 'Charlie',
        source: '/c.tsx',
        framework: 'react',
        props: [{ name: 'z', type: 'string', required: false }],
        slots: [],
      },
    ];
    const validatedComponents = validateExtractedComponents(filteredComponents);
    const { rows } = buildAnalyzeViewRows(filteredComponents, validatedComponents, []);
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('filters per-component warnings by "name:" prefix', () => {
    const filteredComponents: RawComponentDefinition[] = [
      {
        name: 'Alpha',
        source: '/a.tsx',
        framework: 'react',
        props: [{ name: 'x', type: 'string', required: false }],
        slots: [],
      },
      {
        name: 'Bravo',
        source: '/b.tsx',
        framework: 'react',
        props: [{ name: 'y', type: 'string', required: false }],
        slots: [],
      },
    ];
    const validatedComponents = validateExtractedComponents(filteredComponents);
    const allWarnings = ['Alpha: confidence low', 'Bravo: weird type', 'Other: irrelevant'];
    const { rows } = buildAnalyzeViewRows(filteredComponents, validatedComponents, allWarnings);
    expect(rows[0].warnings).toEqual(['Alpha: confidence low']);
    expect(rows[1].warnings).toEqual(['Bravo: weird type']);
  });

  it('throws when arrays are misaligned in length', () => {
    const filteredComponents: RawComponentDefinition[] = [
      { name: 'A', source: '/a.tsx', framework: 'react', props: [], slots: [] },
      { name: 'B', source: '/b.tsx', framework: 'react', props: [], slots: [] },
    ];
    const validatedComponents = validateExtractedComponents([filteredComponents[0]]);
    expect(() => buildAnalyzeViewRows(filteredComponents, validatedComponents, [])).toThrow(/length/i);
  });
});
