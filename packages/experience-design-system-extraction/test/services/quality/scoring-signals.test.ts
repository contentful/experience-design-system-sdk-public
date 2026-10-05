import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../../../src/extract/types/component.js';
import {
  isWidePrimitiveUnion,
  countExtractionIssues,
  mapIssueCountToConfidence,
} from '../../../src/extract/services/quality/helpers/scoring/scoring-signals.js';

function component(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'MyComponent',
    source: '/path/MyComponent.tsx',
    sourcePath: '/path/MyComponent.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

function prop(name: string, type: string, description?: string) {
  return { name, type, required: false, description };
}

describe('isWidePrimitiveUnion', () => {
  it('returns true when three base primitives appear', () => {
    expect(isWidePrimitiveUnion('string | number | boolean')).toBe(true);
  });

  it('returns false for a simple nullable string', () => {
    expect(isWidePrimitiveUnion('string | null | undefined')).toBe(false);
  });

  it('returns false for string | number (only two)', () => {
    expect(isWidePrimitiveUnion('string | number')).toBe(false);
  });

  it('returns true for string | number | null | undefined (two primitives + two nullability = 4 parts, baseCount=2 + nullability)', () => {
    // baseCount=2, nullabilityCount=2, baseCount+nullabilityCount=4 >= 3 → true
    expect(isWidePrimitiveUnion('string | number | null | undefined')).toBe(true);
  });
});

describe('countExtractionIssues', () => {
  it('counts no-props-or-slots as one issue', () => {
    const { count, reasons } = countExtractionIssues(component());
    expect(count).toBe(1);
    expect(reasons).toContain('no-props-or-slots');
  });

  it('counts no issues for a well-formed component with described props', () => {
    const c = component({
      props: [prop('label', 'string', 'The button label')],
    });
    const { count } = countExtractionIssues(c);
    expect(count).toBe(0);
  });

  it('counts opaque type as an issue', () => {
    const c = component({ props: [prop('data', 'any')] });
    const { count, reasons } = countExtractionIssues(c);
    expect(count).toBe(1);
    expect(reasons.some((r) => r.startsWith('opaque-type:'))).toBe(true);
  });

  it('counts missing description as an issue for non-obvious prop names', () => {
    const c = component({ props: [prop('customProp', 'string')] });
    const { count, reasons } = countExtractionIssues(c);
    expect(count).toBe(1);
    expect(reasons).toContain('props-missing-description');
  });

  it('does not count missing description for obvious prop names', () => {
    const c = component({ props: [prop('label', 'string')] });
    const { count } = countExtractionIssues(c);
    expect(count).toBe(0);
  });

  it('counts high prop count as an issue', () => {
    const manyProps = Array.from({ length: 51 }, (_, i) => prop(`p${i}`, 'string', 'desc'));
    const c = component({ props: manyProps });
    const { count, reasons } = countExtractionIssues(c);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(reasons.some((r) => r.startsWith('high-prop-count:'))).toBe(true);
  });

  it('includes additional issues from options', () => {
    const c = component({ props: [prop('label', 'string', 'The label')] });
    const { count, reasons } = countExtractionIssues(c, {
      additionalIssueCount: 2,
      additionalReasons: ['custom-reason'],
    });
    expect(count).toBe(2);
    expect(reasons).toContain('custom-reason');
  });
});

describe('mapIssueCountToConfidence', () => {
  it('maps 0 issues → confidence 5', () => expect(mapIssueCountToConfidence(0)).toBe(5));
  it('maps 1 issue → confidence 4', () => expect(mapIssueCountToConfidence(1)).toBe(4));
  it('maps 2 issues → confidence 3', () => expect(mapIssueCountToConfidence(2)).toBe(3));
  it('maps 3 issues → confidence 2', () => expect(mapIssueCountToConfidence(3)).toBe(2));
  it('maps 4+ issues → confidence 1', () => {
    expect(mapIssueCountToConfidence(4)).toBe(1);
    expect(mapIssueCountToConfidence(10)).toBe(1);
  });
});
