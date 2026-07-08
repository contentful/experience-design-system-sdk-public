import { describe, it, expect } from 'vitest';
import {
  shouldExcludeDueToValidation,
  validateExtractedComponents,
} from '@contentful/experience-design-system-extraction';
import type { RawComponentDefinition } from '../../../src/types.js';

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

describe('shouldExcludeDueToValidation', () => {
  it('returns true when component has error-severity issues', () => {
    const component = makeComponent({
      validationIssues: [{ severity: 'error', code: 'EMPTY_COMPONENT_NAME', message: 'Empty name' }],
    });
    expect(shouldExcludeDueToValidation(component)).toBe(true);
  });

  it('returns false when component has only warning-severity issues', () => {
    const component = makeComponent({
      validationIssues: [{ severity: 'warning', code: 'EMPTY_COMPONENT', message: 'No props or slots' }],
    });
    expect(shouldExcludeDueToValidation(component)).toBe(false);
  });

  it('returns false when component has no validation issues', () => {
    const component = makeComponent({ validationIssues: [] });
    expect(shouldExcludeDueToValidation(component)).toBe(false);
  });

  it('returns false when validationIssues is undefined', () => {
    const component = makeComponent({ validationIssues: undefined });
    expect(shouldExcludeDueToValidation(component)).toBe(false);
  });
});

describe('validateExtractedComponents idempotency', () => {
  it('produces the same issues when called twice on the same input (re-validation is safe)', () => {
    const components: RawComponentDefinition[] = [
      makeComponent({ name: '' }),
      makeComponent({ name: 'Button', props: [{ name: 'variant', type: 'string', required: false }] }),
    ];
    const first = validateExtractedComponents(components);
    const second = validateExtractedComponents(first);
    expect(second[0].validationIssues).toEqual(first[0].validationIssues);
    expect(second[1].validationIssues).toEqual(first[1].validationIssues);
  });
});
