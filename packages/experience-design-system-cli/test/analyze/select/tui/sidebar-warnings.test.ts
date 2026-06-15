import { describe, it, expect } from 'vitest';
import {
  sortComponentsForSidebar,
  statusIcon,
  statusColor,
} from '../../../../src/analyze/select/tui/components/Sidebar.js';
import type { ReviewComponentSummary } from '../../../../src/analyze/select/types.js';

function makeSummary(overrides: Partial<ReviewComponentSummary> = {}): ReviewComponentSummary {
  return {
    id: 'x',
    name: 'X',
    status: 'needs-review',
    extractionConfidence: null,
    needsReview: false,
    validationErrorCount: 0,
    validationWarningCount: 0,
    ...overrides,
  };
}

describe('sortComponentsForSidebar three-way partition', () => {
  it('orders errors before warnings, warnings before clean', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: 'clean' }),
      makeSummary({ id: 'warn', validationWarningCount: 1 }),
      makeSummary({ id: 'err', validationErrorCount: 1 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted.map((c) => c.id)).toEqual(['err', 'warn', 'clean']);
  });

  it('component with both errors and warnings sorts as error', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: 'warn', validationWarningCount: 1 }),
      makeSummary({ id: 'both', validationErrorCount: 1, validationWarningCount: 1 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted.map((c) => c.id)).toEqual(['both', 'warn']);
  });

  it('preserves stable order within each tier', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: 'w1', validationWarningCount: 1 }),
      makeSummary({ id: 'e1', validationErrorCount: 1 }),
      makeSummary({ id: 'w2', validationWarningCount: 1 }),
      makeSummary({ id: 'e2', validationErrorCount: 1 }),
      makeSummary({ id: 'c1' }),
      makeSummary({ id: 'c2' }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted.map((c) => c.id)).toEqual(['e1', 'e2', 'w1', 'w2', 'c1', 'c2']);
  });
});

describe('statusIcon / statusColor warning vs error', () => {
  it('warning-only component shows status icon (not ⚠) so user accept/reject decision is visible', () => {
    // Color stays yellow so the warning cue is preserved, but the icon reflects user decision.
    expect(statusIcon('needs-review', 0, 1)).toBe('·');
    expect(statusColor('needs-review', 0, 1)).toBe('yellow');
  });

  it('warning-only accepted component shows ✓, not ⚠', () => {
    expect(statusIcon('accepted', 0, 1)).toBe('✓');
    expect(statusColor('accepted', 0, 1)).toBe('yellow');
  });

  it('warning-only rejected component shows ✗, not ⚠', () => {
    expect(statusIcon('rejected', 0, 1)).toBe('✗');
    expect(statusColor('rejected', 0, 1)).toBe('yellow');
  });

  it('warning-only reviewed component shows ~, not ⚠', () => {
    expect(statusIcon('reviewed', 0, 1)).toBe('~');
    expect(statusColor('reviewed', 0, 1)).toBe('yellow');
  });

  it('returns red ⚠ when both errors and warnings present (errors override icon and color)', () => {
    expect(statusIcon('needs-review', 1, 1)).toBe('⚠');
    expect(statusColor('needs-review', 1, 1)).toBe('red');
  });

  it('error-only component overrides icon to ⚠ regardless of status (component is structurally broken)', () => {
    expect(statusIcon('needs-review', 1, 0)).toBe('⚠');
    expect(statusColor('needs-review', 1, 0)).toBe('red');
    expect(statusIcon('accepted', 1, 0)).toBe('⚠');
    expect(statusColor('accepted', 1, 0)).toBe('red');
    expect(statusIcon('rejected', 1, 0)).toBe('⚠');
    expect(statusIcon('reviewed', 1, 0)).toBe('⚠');
  });

  it('returns clean status icon and color when no validation issues', () => {
    expect(statusIcon('accepted', 0, 0)).toBe('✓');
    expect(statusColor('accepted', 0, 0)).toBe('green');
    expect(statusIcon('rejected', 0, 0)).toBe('✗');
    expect(statusColor('rejected', 0, 0)).toBe('red');
    expect(statusIcon('needs-review', 0, 0)).toBe('·');
    expect(statusColor('needs-review', 0, 0)).toBe('white');
    expect(statusIcon('reviewed', 0, 0)).toBe('~');
    expect(statusColor('reviewed', 0, 0)).toBe('yellow');
  });
});
