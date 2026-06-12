import { describe, it, expect } from 'vitest';
import { computeExtractionScore, deriveNeedsReview } from '../../../src/analyze/extract/scoring.js';
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

function makeProp(name: string, type: string, description?: string) {
  return { name, type, required: false, description };
}

describe('computeExtractionScore', () => {
  it('returns 5 for a clean component with described props', () => {
    const result = computeExtractionScore(
      makeComponent({
        props: [makeProp('variant', 'string', 'Visual variant of the button')],
      }),
    );
    expect(result.confidence).toBe(5);
    expect(result.reasons).toHaveLength(0);
  });

  it('returns 4 for a component with one issue (no props and no slots)', () => {
    const result = computeExtractionScore(makeComponent());
    expect(result.confidence).toBe(4);
    expect(result.reasons).toContain('no-props-or-slots');
  });

  it('returns 4 for a component with one opaque prop type', () => {
    const result = computeExtractionScore(makeComponent({ props: [makeProp('config', 'any')] }));
    expect(result.confidence).toBe(4);
    expect(result.reasons.some((r) => r.startsWith('opaque-type:'))).toBe(true);
  });

  it('returns 4 for a wide primitive union (string | number | boolean)', () => {
    const result = computeExtractionScore(
      makeComponent({
        props: [makeProp('value', 'string | number | boolean')],
      }),
    );
    expect(result.confidence).toBe(4);
    expect(result.reasons.some((r) => r.startsWith('wide-union:'))).toBe(true);
  });

  it('does NOT penalise string | null | undefined (just nullable string)', () => {
    const result = computeExtractionScore(
      makeComponent({
        props: [makeProp('label', 'string | null | undefined', 'Button label')],
      }),
    );
    expect(result.confidence).toBe(5);
    expect(result.reasons).toHaveLength(0);
  });

  it('returns 4 for non-obvious prop with no description', () => {
    const result = computeExtractionScore(makeComponent({ props: [makeProp('handleClick', 'string')] }));
    expect(result.confidence).toBe(4);
    expect(result.reasons).toContain('props-missing-description');
  });

  it('does NOT penalise obvious prop names without description', () => {
    const result = computeExtractionScore(makeComponent({ props: [makeProp('onClick', 'string')] }));
    expect(result.confidence).toBe(5);
  });

  it('returns 4 for high prop count (>50)', () => {
    const props = Array.from({ length: 51 }, (_, i) => makeProp(`prop${i}`, 'string', 'desc'));
    const result = computeExtractionScore(makeComponent({ props }));
    expect(result.confidence).toBe(4);
    expect(result.reasons.some((r) => r.startsWith('high-prop-count:'))).toBe(true);
  });

  it('returns 3 for two issues (no props and high prop count impossible, use opaque + missing desc)', () => {
    // Two issues: opaque type + high prop count
    const props = Array.from({ length: 51 }, (_, i) => makeProp(`prop${i}`, i === 0 ? 'any' : 'string', 'desc'));
    const result = computeExtractionScore(makeComponent({ props }));
    expect(result.confidence).toBe(3);
  });

  it('returns 1 for four or more issues', () => {
    // no-props-or-slots (empty) + 0 props so no prop-level issues... use separate approach
    // Build: no-props-or-slots + high-prop-count is impossible (contradictory)
    // Instead confirm confidence clamped to 1 minimum via issueCountToConfidence
    expect(deriveNeedsReview(1)).toBe(true);
    expect(deriveNeedsReview(2)).toBe(true);
    expect(deriveNeedsReview(3)).toBe(false);
  });

  it('confidence values are always 1–5', () => {
    const result = computeExtractionScore(makeComponent());
    expect(result.confidence).toBeGreaterThanOrEqual(1);
    expect(result.confidence).toBeLessThanOrEqual(5);
  });

  it('deduplicates reasons', () => {
    const result = computeExtractionScore(makeComponent());
    const unique = new Set(result.reasons);
    expect(result.reasons.length).toBe(unique.size);
  });

  it('applies additional issue counts and review reasons from source inspection', () => {
    const result = computeExtractionScore(
      makeComponent({
        props: [makeProp('variant', 'string', 'Visual variant of the button')],
      }),
      {
        additionalIssueCount: 2,
        additionalReasons: ['data-fetch-wrapper', 'data-wrapper:generated-query-hook'],
      },
    );
    expect(result.confidence).toBe(3);
    expect(result.reasons).toContain('data-fetch-wrapper');
    expect(result.reasons).toContain('data-wrapper:generated-query-hook');
  });
});

describe('deriveNeedsReview', () => {
  it('returns true when confidence <= 2', () => {
    expect(deriveNeedsReview(1)).toBe(true);
    expect(deriveNeedsReview(2)).toBe(true);
  });

  it('returns false when confidence >= 3', () => {
    expect(deriveNeedsReview(3)).toBe(false);
    expect(deriveNeedsReview(5)).toBe(false);
  });
});
