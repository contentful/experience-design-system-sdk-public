import { describe, it, expect } from 'vitest';
import {
  buildAnalyzeViewRows,
  isWarningForComponent,
  partitionGlobalWarnings,
} from '../../src/analyze/build-analyze-view-rows.js';
import { validateExtractedComponents } from '../../src/analyze/extract/validate.js';
import type { RawComponentDefinition } from '../../src/types.js';

describe('buildAnalyzeViewRows', () => {
  it('attaches validation errors to BOTH rows when two components share a name (positional contract)', () => {
    // P1.3 regression — Bito flagged that keying validated components by `name`
    // silently dropped errors for the first of any duplicate-named pair, since
    // `Map.set` overwrites by key. We seed two components named "Button" with
    // DIFFERENT non-duplicate validation findings (empty prop name vs.
    // prop/slot collision) so the test asserts the positional pairing
    // contract directly without depending on duplicate-name behaviour itself.
    const filteredComponents: RawComponentDefinition[] = [
      {
        name: 'Button',
        source: '/src/a/Button.tsx',
        framework: 'react',
        // Empty prop name → EMPTY_PROP_NAME error.
        props: [{ name: '', type: 'string', required: false }],
        slots: [],
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
    expect((validatedComponents[0].validationIssues ?? []).some((i) => i.code === 'EMPTY_PROP_NAME')).toBe(true);
    expect((validatedComponents[1].validationIssues ?? []).some((i) => i.code === 'PROP_SLOT_NAME_COLLISION')).toBe(
      true,
    );

    const { rows, totalErrors } = buildAnalyzeViewRows(filteredComponents, validatedComponents, []);

    expect(rows).toHaveLength(2);
    // Each row must surface its OWN component's errors. Under a name-keyed
    // Map, both rows get the second component's errors — the first row's
    // EMPTY_PROP_NAME is silently dropped.
    expect(rows[0].errors.some((m) => m === 'Prop at index 0 has an empty name')).toBe(true);
    expect(rows[1].errors.some((m) => m.includes('used as both a prop name and a slot name'))).toBe(true);
    // The first row must NOT carry the second component's collision error,
    // and the second row must NOT carry the first component's empty-prop error.
    expect(rows[0].errors.some((m) => m.includes('used as both a prop name and a slot name'))).toBe(false);
    expect(rows[1].errors.some((m) => m === 'Prop at index 0 has an empty name')).toBe(false);
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

describe('warnings split — symmetry between buildAnalyzeViewRows and partitionGlobalWarnings', () => {
  // The two halves of warning placement MUST stay aligned: every warning
  // attached to a component row must be excluded from globals (no double-render),
  // and every warning not attached to any row must fall through to globals
  // (no silent drop). These tests assert that contract directly so a future
  // change to either half can't drift in isolation.

  function makeComponent(name: string): RawComponentDefinition {
    return { name, source: `/src/${name}.svelte`, framework: 'svelte', props: [], slots: [] };
  }

  it('is symmetric: every warning lands in exactly one bucket (per-component OR global)', () => {
    const filtered = [makeComponent('AccordionItem'), makeComponent('Button'), makeComponent('Card')];
    const validated = validateExtractedComponents(filtered);
    const allWarnings = [
      'AccordionItem: rest element dropped',
      'Button: declared Props type X resolved to 0 properties',
      'Card: warns about something',
      'Skipped non-authorable component: SomethingElseRootProvider (...)',
      'Unresolved-type retry pass (mode=auto): tsconfig recovered 5 component(s)',
    ];

    const { rows } = buildAnalyzeViewRows(filtered, validated, allWarnings);
    const componentNames = rows.map((r) => r.name);
    const globalWarnings = partitionGlobalWarnings(allWarnings, componentNames);

    // Per-component warnings: 3 — one per row
    const totalPerComponent = rows.reduce((acc, r) => acc + r.warnings.length, 0);
    expect(totalPerComponent).toBe(3);
    expect(rows[0].warnings).toEqual(['AccordionItem: rest element dropped']);
    expect(rows[1].warnings).toEqual(['Button: declared Props type X resolved to 0 properties']);
    expect(rows[2].warnings).toEqual(['Card: warns about something']);

    // Global: the 2 that don't start with any component name
    expect(globalWarnings).toEqual([
      'Skipped non-authorable component: SomethingElseRootProvider (...)',
      'Unresolved-type retry pass (mode=auto): tsconfig recovered 5 component(s)',
    ]);

    // Total = inputs (no double-counting, no silent drop)
    expect(totalPerComponent + globalWarnings.length).toBe(allWarnings.length);
  });

  it('classifies a warning prefixed with a non-surviving component name as global (not silently dropped)', () => {
    // The component was filtered out (e.g. non-authorable skip), so its warning
    // has no row to attach to. It must fall through to globals, not vanish.
    const filtered = [makeComponent('Button')];
    const validated = validateExtractedComponents(filtered);
    const allWarnings = ['Button: ok', 'AccordionItem: leftover from a filtered-out component'];

    const { rows } = buildAnalyzeViewRows(filtered, validated, allWarnings);
    const globalWarnings = partitionGlobalWarnings(
      allWarnings,
      rows.map((r) => r.name),
    );

    expect(rows[0].warnings).toEqual(['Button: ok']);
    expect(globalWarnings).toEqual(['AccordionItem: leftover from a filtered-out component']);
  });

  it('isWarningForComponent only matches the exact-name `<name>:` prefix (no false positives)', () => {
    // Substring matches against another component's name must NOT trigger.
    expect(isWarningForComponent('Card: ok', 'Card')).toBe(true);
    expect(isWarningForComponent('CardHeader: ok', 'Card')).toBe(false);
    expect(isWarningForComponent('Card:no-space', 'Card')).toBe(true);
    // A warning that doesn't even contain the name doesn't match.
    expect(isWarningForComponent('Other: msg', 'Card')).toBe(false);
    // A bare colon-less warning doesn't match.
    expect(isWarningForComponent('Card', 'Card')).toBe(false);
  });

  it('contract regression: buildAnalyzeViewRows and partitionGlobalWarnings disagree → test fails', () => {
    // If either half drifts (e.g. someone changes `partitionGlobalWarnings` to
    // require a space after the colon while the row builder still uses bare ':'),
    // a warning attached to a row could simultaneously be classified as global —
    // this test asserts that does NOT happen for the canonical warning shape.
    const filtered = [makeComponent('Button')];
    const validated = validateExtractedComponents(filtered);

    // Both no-space and space-after-colon variants of the canonical prefix.
    const variants = ['Button:no-space-message', 'Button: with-space-message'];
    const { rows } = buildAnalyzeViewRows(filtered, validated, variants);
    const globalWarnings = partitionGlobalWarnings(
      variants,
      rows.map((r) => r.name),
    );

    // Each variant must land in exactly one bucket — never both, never neither.
    for (const w of variants) {
      const inRow = rows.some((r) => r.warnings.includes(w));
      const inGlobal = globalWarnings.includes(w);
      expect(inRow !== inGlobal, `warning ${JSON.stringify(w)} must be in exactly one bucket`).toBe(true);
    }
  });
});
