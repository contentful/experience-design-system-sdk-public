import { describe, it, expect } from 'vitest';
import type { ExtractionValidationIssue } from '../../../src/analyze/extract/validate.js';
import type { RawComponentDefinition } from '../../../src/types.js';

describe('ExtractionValidationIssue type', () => {
  it('accepts an error issue', () => {
    const issue: ExtractionValidationIssue = {
      severity: 'error',
      code: 'EMPTY_COMPONENT_NAME',
      message: 'Component name must not be empty',
    };
    expect(issue.severity).toBe('error');
    expect(issue.code).toBe('EMPTY_COMPONENT_NAME');
  });

  it('accepts a warning issue', () => {
    const issue: ExtractionValidationIssue = {
      severity: 'warning',
      code: 'EMPTY_COMPONENT',
      message: 'Component has no props or slots',
    };
    expect(issue.severity).toBe('warning');
  });

  it('accepts an issue scoped to a slot', () => {
    const issue: ExtractionValidationIssue = {
      severity: 'error',
      code: 'EMPTY_SLOT_NAME',
      message: 'Slot name must not be empty',
      field: 'slots[0].name',
    };
    expect(issue.field).toBe('slots[0].name');
  });
});

describe('RawComponentDefinition with validationIssues', () => {
  it('allows components with no validation issues', () => {
    const component: RawComponentDefinition = {
      name: 'Button',
      source: '/src/Button.tsx',
      framework: 'react',
      props: [],
      slots: [],
      validationIssues: [],
    };
    expect(component.validationIssues).toHaveLength(0);
  });

  it('allows components with validation issues', () => {
    const component: RawComponentDefinition = {
      name: '',
      source: '/src/Bad.tsx',
      framework: 'react',
      props: [],
      slots: [],
      validationIssues: [
        { severity: 'error', code: 'EMPTY_COMPONENT_NAME', message: 'Component name must not be empty' },
      ],
    };
    expect(component.validationIssues).toHaveLength(1);
    expect(component.validationIssues![0].severity).toBe('error');
  });
});

import { validateExtractedComponents, shouldExcludeDueToValidation } from '../../../src/analyze/extract/validate.js';

function makeComponent(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'Button',
    source: '/src/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

describe('validateExtractedComponents', () => {
  describe('EMPTY_COMPONENT_NAME', () => {
    it('flags a component with an empty name as an error', () => {
      const components = [makeComponent({ name: '' })];
      const result = validateExtractedComponents(components);
      const issues = result[0].validationIssues ?? [];
      expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'EMPTY_COMPONENT_NAME' }));
    });

    it('flags a component with a whitespace-only name as an error', () => {
      const components = [makeComponent({ name: '   ' })];
      const result = validateExtractedComponents(components);
      expect(result[0].validationIssues).toContainEqual(
        expect.objectContaining({ severity: 'error', code: 'EMPTY_COMPONENT_NAME' }),
      );
    });

    it('does not flag a component with a valid name', () => {
      const components = [makeComponent({ name: 'Button' })];
      const result = validateExtractedComponents(components);
      const errorCodes = (result[0].validationIssues ?? []).map((i) => i.code);
      expect(errorCodes).not.toContain('EMPTY_COMPONENT_NAME');
    });
  });

  describe('EMPTY_PROP_NAME', () => {
    it('flags a prop with an empty name as an error', () => {
      const components = [
        makeComponent({
          props: [{ name: '', type: 'string', required: false }],
        }),
      ];
      const result = validateExtractedComponents(components);
      expect(result[0].validationIssues).toContainEqual(
        expect.objectContaining({ severity: 'error', code: 'EMPTY_PROP_NAME', field: 'props[0].name' }),
      );
    });

    it('does not flag props with valid names', () => {
      const components = [
        makeComponent({
          props: [{ name: 'variant', type: 'string', required: false }],
        }),
      ];
      const result = validateExtractedComponents(components);
      const codes = (result[0].validationIssues ?? []).map((i) => i.code);
      expect(codes).not.toContain('EMPTY_PROP_NAME');
    });
  });

  describe('EMPTY_SLOT_NAME', () => {
    it('flags a slot with an empty name as an error', () => {
      const components = [
        makeComponent({
          slots: [{ name: '', isDefault: false }],
        }),
      ];
      const result = validateExtractedComponents(components);
      expect(result[0].validationIssues).toContainEqual(
        expect.objectContaining({ severity: 'error', code: 'EMPTY_SLOT_NAME', field: 'slots[0].name' }),
      );
    });

    it('flags multiple invalid slots independently', () => {
      const components = [
        makeComponent({
          slots: [
            { name: '', isDefault: false },
            { name: 'valid', isDefault: false },
            { name: '  ', isDefault: false },
          ],
        }),
      ];
      const result = validateExtractedComponents(components);
      const issues = (result[0].validationIssues ?? []).filter((i) => i.code === 'EMPTY_SLOT_NAME');
      expect(issues).toHaveLength(2);
      expect(issues[0].field).toBe('slots[0].name');
      expect(issues[1].field).toBe('slots[2].name');
    });

    it('does not flag a slot with a valid name', () => {
      const components = [makeComponent({ slots: [{ name: 'icon', isDefault: false }] })];
      const result = validateExtractedComponents(components);
      const codes = (result[0].validationIssues ?? []).map((i) => i.code);
      expect(codes).not.toContain('EMPTY_SLOT_NAME');
    });
  });

  describe('PROP_SLOT_NAME_COLLISION', () => {
    it('flags when a prop and slot share the same name', () => {
      const components = [
        makeComponent({
          props: [{ name: 'icon', type: 'string', required: false }],
          slots: [{ name: 'icon', isDefault: false }],
        }),
      ];
      const result = validateExtractedComponents(components);
      expect(result[0].validationIssues).toContainEqual(
        expect.objectContaining({ severity: 'error', code: 'PROP_SLOT_NAME_COLLISION' }),
      );
    });

    it('does not flag when prop and slot have different names', () => {
      const components = [
        makeComponent({
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [{ name: 'icon', isDefault: false }],
        }),
      ];
      const result = validateExtractedComponents(components);
      const codes = (result[0].validationIssues ?? []).map((i) => i.code);
      expect(codes).not.toContain('PROP_SLOT_NAME_COLLISION');
    });

    it('flags multiple collisions on the same component', () => {
      const components = [
        makeComponent({
          props: [
            { name: 'icon', type: 'string', required: false },
            { name: 'footer', type: 'string', required: false },
          ],
          slots: [
            { name: 'icon', isDefault: false },
            { name: 'footer', isDefault: false },
          ],
        }),
      ];
      const result = validateExtractedComponents(components);
      const collisions = (result[0].validationIssues ?? []).filter((i) => i.code === 'PROP_SLOT_NAME_COLLISION');
      expect(collisions).toHaveLength(2);
    });
  });

  describe('DUPLICATE_COMPONENT_NAME', () => {
    it('flags both components with duplicate names across the set as errors', () => {
      const components = [
        makeComponent({ name: 'Button', source: '/pkg-a/Button.tsx' }),
        makeComponent({ name: 'Button', source: '/pkg-b/Button.tsx' }),
      ];
      const result = validateExtractedComponents(components);
      const allIssues = result.flatMap((c) => c.validationIssues ?? []);
      const dupeIssues = allIssues.filter((i) => i.code === 'DUPLICATE_COMPONENT_NAME');
      expect(dupeIssues).toHaveLength(2);
      expect(dupeIssues[0].severity).toBe('error');
      expect(dupeIssues[1].severity).toBe('error');
    });

    it('does not flag when all component names are unique', () => {
      const components = [makeComponent({ name: 'Button' }), makeComponent({ name: 'Card' })];
      const result = validateExtractedComponents(components);
      const allIssues = result.flatMap((c) => c.validationIssues ?? []);
      expect(allIssues.filter((i) => i.code === 'DUPLICATE_COMPONENT_NAME')).toHaveLength(0);
    });

    it('causes shouldExcludeDueToValidation to return true for duplicate-named components', () => {
      const components = [
        makeComponent({ name: 'Button', source: '/pkg-a/Button.tsx' }),
        makeComponent({ name: 'Button', source: '/pkg-b/Button.tsx' }),
      ];
      const result = validateExtractedComponents(components);
      expect(shouldExcludeDueToValidation(result[0])).toBe(true);
      expect(shouldExcludeDueToValidation(result[1])).toBe(true);
    });
  });

  describe('EMPTY_COMPONENT', () => {
    it('flags a component with no props and no slots as a warning', () => {
      const components = [makeComponent({ props: [], slots: [] })];
      const result = validateExtractedComponents(components);
      expect(result[0].validationIssues).toContainEqual(
        expect.objectContaining({ severity: 'warning', code: 'EMPTY_COMPONENT' }),
      );
    });

    it('does not flag a component with at least one prop', () => {
      const components = [makeComponent({ props: [{ name: 'variant', type: 'string', required: false }] })];
      const result = validateExtractedComponents(components);
      const codes = (result[0].validationIssues ?? []).map((i) => i.code);
      expect(codes).not.toContain('EMPTY_COMPONENT');
    });

    it('does not flag a component with at least one slot', () => {
      const components = [makeComponent({ slots: [{ name: 'icon', isDefault: false }] })];
      const result = validateExtractedComponents(components);
      const codes = (result[0].validationIssues ?? []).map((i) => i.code);
      expect(codes).not.toContain('EMPTY_COMPONENT');
    });
  });

  describe('clean components', () => {
    it('returns empty validationIssues for a fully valid component', () => {
      const components = [
        makeComponent({
          name: 'Card',
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [{ name: 'icon', isDefault: false }],
        }),
      ];
      const result = validateExtractedComponents(components);
      expect(result[0].validationIssues).toHaveLength(0);
    });

    it('preserves all original component fields', () => {
      const components = [
        makeComponent({
          name: 'Card',
          source: '/src/Card.tsx',
          framework: 'react',
          props: [{ name: 'variant', type: 'string', required: false }],
          slots: [],
          extractionConfidence: 4,
          needsReview: false,
        }),
      ];
      const result = validateExtractedComponents(components);
      expect(result[0].name).toBe('Card');
      expect(result[0].source).toBe('/src/Card.tsx');
      expect(result[0].extractionConfidence).toBe(4);
    });
  });
});
