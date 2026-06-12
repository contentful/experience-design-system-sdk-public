import { describe, it, expect } from 'vitest';
import { sortComponentsForSidebar } from '../../../../src/analyze/select/tui/components/Sidebar.js';
import type { ReviewComponentSummary } from '../../../../src/analyze/select/types.js';

function makeSummary(overrides: Partial<ReviewComponentSummary> = {}): ReviewComponentSummary {
  return {
    id: 'abc',
    name: 'Button',
    status: 'needs-review',
    extractionConfidence: null,
    needsReview: false,
    validationErrorCount: 0,
    validationWarningCount: 0,
    ...overrides,
  };
}

describe('sortComponentsForSidebar', () => {
  it('places components with validation errors before those without', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', name: 'Clean', validationErrorCount: 0 }),
      makeSummary({ id: '2', name: 'Broken', validationErrorCount: 2 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
  });

  it('preserves original order among components with no errors', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', name: 'Alpha', validationErrorCount: 0 }),
      makeSummary({ id: '2', name: 'Beta', validationErrorCount: 0 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('1');
    expect(sorted[1].id).toBe('2');
  });

  it('preserves original order among components with errors', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', name: 'BrokenA', validationErrorCount: 1 }),
      makeSummary({ id: '2', name: 'Clean', validationErrorCount: 0 }),
      makeSummary({ id: '3', name: 'BrokenB', validationErrorCount: 3 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('1');
    expect(sorted[1].id).toBe('3');
    expect(sorted[2].id).toBe('2');
  });

  it('returns the same array length', () => {
    const input = [
      makeSummary({ id: '1', validationErrorCount: 0 }),
      makeSummary({ id: '2', validationErrorCount: 1 }),
      makeSummary({ id: '3', validationErrorCount: 0 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted).toHaveLength(3);
  });

  it('does not mutate the input array', () => {
    const input = [
      makeSummary({ id: '1', validationErrorCount: 0 }),
      makeSummary({ id: '2', validationErrorCount: 1 }),
    ];
    const originalFirst = input[0].id;
    sortComponentsForSidebar(input);
    expect(input[0].id).toBe(originalFirst);
  });
});
