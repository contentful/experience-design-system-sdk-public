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
  it('returns 100 for a clean component with described props', () => {
    const result = computeExtractionScore(
      makeComponent({
        props: [makeProp('variant', 'string', 'Visual variant of the button')],
      }),
    );
    expect(result.confidence).toBe(100);
    expect(result.reasons).toHaveLength(0);
  });

  it('penalises -15 for no props and no slots', () => {
    const result = computeExtractionScore(makeComponent());
    expect(result.confidence).toBe(85);
    expect(result.reasons).toContain('no-props-or-slots');
  });

  it('penalises -20 for an opaque prop type', () => {
    const result = computeExtractionScore(makeComponent({ props: [makeProp('config', 'any')] }));
    expect(result.confidence).toBe(80);
    expect(result.reasons.some((r) => r.startsWith('opaque-type:'))).toBe(true);
  });

  it('penalises -10 for a wide primitive union (string | number | boolean)', () => {
    const result = computeExtractionScore(makeComponent({ props: [makeProp('value', 'string | number | boolean')] }));
    expect(result.confidence).toBe(90);
    expect(result.reasons.some((r) => r.startsWith('wide-union:'))).toBe(true);
  });

  it('does NOT penalise string | null | undefined (just nullable string)', () => {
    const result = computeExtractionScore(
      makeComponent({ props: [makeProp('label', 'string | null | undefined', 'Button label')] }),
    );
    expect(result.confidence).toBe(100);
    expect(result.reasons).toHaveLength(0);
  });

  it('penalises -10 for non-obvious prop with no description', () => {
    const result = computeExtractionScore(makeComponent({ props: [makeProp('handleClick', 'string')] }));
    expect(result.confidence).toBe(90);
    expect(result.reasons).toContain('props-missing-description');
  });

  it('does NOT penalise obvious prop names without description', () => {
    const result = computeExtractionScore(makeComponent({ props: [makeProp('onClick', 'string')] }));
    expect(result.confidence).toBe(100);
  });

  it('penalises -20 for high prop count (>50)', () => {
    const props = Array.from({ length: 51 }, (_, i) => makeProp(`prop${i}`, 'string', 'desc'));
    const result = computeExtractionScore(makeComponent({ props }));
    expect(result.confidence).toBe(80);
    expect(result.reasons.some((r) => r.startsWith('high-prop-count:'))).toBe(true);
  });

  it('clamps confidence to 0 minimum', () => {
    const props = Array.from({ length: 60 }, (_, i) => makeProp(`prop${i}`, 'any'));
    const result = computeExtractionScore(makeComponent({ props }));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('deduplicates reasons', () => {
    const result = computeExtractionScore(makeComponent());
    const unique = new Set(result.reasons);
    expect(result.reasons.length).toBe(unique.size);
  });
});

describe('deriveNeedsReview', () => {
  it('returns true when confidence < 70', () => {
    expect(deriveNeedsReview(69)).toBe(true);
    expect(deriveNeedsReview(0)).toBe(true);
  });

  it('returns false when confidence >= 70', () => {
    expect(deriveNeedsReview(70)).toBe(false);
    expect(deriveNeedsReview(100)).toBe(false);
  });
});
