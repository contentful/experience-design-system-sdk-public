import { describe, it, expect } from 'vitest';
import {
  sortComponentsForSidebar,
  statusIcon,
  statusColor,
  previewBadge,
} from '../../../../src/analyze/select/tui/components/Sidebar.js';
import { PALETTE } from '../../../../src/analyze/select/tui/theme.js';
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

  it('preserves original order among components with no errors when no secondary signal differs', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', name: 'Alpha', validationErrorCount: 0 }),
      makeSummary({ id: '2', name: 'Beta', validationErrorCount: 0 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('1');
    expect(sorted[1].id).toBe('2');
  });

  it('places components with errors in the error tier (input order within tier when no secondary signal differs)', () => {
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

  it('within a tier, sorts needs-review components first', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', name: 'AlreadyReviewed', status: 'accepted', needsReview: false }),
      makeSummary({ id: '2', name: 'Pending', status: 'needs-review', needsReview: true }),
      makeSummary({ id: '3', name: 'AlsoReviewed', status: 'accepted', needsReview: false }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
    expect(sorted[2].id).toBe('3');
  });

  it('within a tier, sorts by extractionConfidence ascending (lowest confidence first)', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', extractionConfidence: 5 }),
      makeSummary({ id: '2', extractionConfidence: 1 }),
      makeSummary({ id: '3', extractionConfidence: 3 }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted.map((c) => c.id)).toEqual(['2', '3', '1']);
  });

  it('treats null extractionConfidence as the lowest priority (sorts after numeric values)', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', extractionConfidence: null }),
      makeSummary({ id: '2', extractionConfidence: 2 }),
      makeSummary({ id: '3', extractionConfidence: null }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
    expect(sorted[2].id).toBe('3');
  });

  it('needs-review beats low confidence (needs-review is the primary secondary signal)', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', extractionConfidence: 1, status: 'accepted', needsReview: false }),
      makeSummary({ id: '2', extractionConfidence: 5, status: 'needs-review', needsReview: true }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
  });

  it('error tier still beats needs-review (validation tier is the primary key)', () => {
    const input: ReviewComponentSummary[] = [
      makeSummary({ id: '1', validationErrorCount: 0, status: 'needs-review', needsReview: true }),
      makeSummary({ id: '2', validationErrorCount: 1, status: 'accepted', needsReview: false }),
    ];
    const sorted = sortComponentsForSidebar(input);
    expect(sorted[0].id).toBe('2');
    expect(sorted[1].id).toBe('1');
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

describe('sortComponentsForSidebar — three-way partition (errors / warnings / clean)', () => {
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

  it('preserves stable order across all three tiers when no secondary signal differs', () => {
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

describe('statusIcon / statusColor — error vs warning vs clean', () => {
  it('warning-only component shows status icon (not ⚠) so user accept/reject decision is visible', () => {
    expect(statusIcon('needs-review', 0, 1)).toBe('·');
    expect(statusColor('needs-review', 0, 1)).toBe(PALETTE.warning);
  });

  it('warning-only accepted component shows ✓, not ⚠', () => {
    expect(statusIcon('accepted', 0, 1)).toBe('✓');
    expect(statusColor('accepted', 0, 1)).toBe(PALETTE.warning);
  });

  it('warning-only rejected component shows ✗, not ⚠', () => {
    expect(statusIcon('rejected', 0, 1)).toBe('✗');
    expect(statusColor('rejected', 0, 1)).toBe(PALETTE.warning);
  });

  it('warning-only reviewed component shows ~, not ⚠', () => {
    expect(statusIcon('reviewed', 0, 1)).toBe('~');
    expect(statusColor('reviewed', 0, 1)).toBe(PALETTE.warning);
  });

  it('returns red ⚠ when both errors and warnings present (errors override icon and color)', () => {
    expect(statusIcon('needs-review', 1, 1)).toBe('⚠');
    expect(statusColor('needs-review', 1, 1)).toBe(PALETTE.error);
  });

  it('error-only component overrides icon to ⚠ regardless of status (component is structurally broken)', () => {
    expect(statusIcon('needs-review', 1, 0)).toBe('⚠');
    expect(statusColor('needs-review', 1, 0)).toBe(PALETTE.error);
    expect(statusIcon('accepted', 1, 0)).toBe('⚠');
    expect(statusColor('accepted', 1, 0)).toBe(PALETTE.error);
    expect(statusIcon('rejected', 1, 0)).toBe('⚠');
    expect(statusIcon('reviewed', 1, 0)).toBe('⚠');
  });

  it('returns clean status icon and palette color when no validation issues', () => {
    expect(statusIcon('accepted', 0, 0)).toBe('✓');
    expect(statusColor('accepted', 0, 0)).toBe(PALETTE.success);
    expect(statusIcon('rejected', 0, 0)).toBe('✗');
    expect(statusColor('rejected', 0, 0)).toBe(PALETTE.error);
    expect(statusIcon('needs-review', 0, 0)).toBe('·');
    // needs-review maps to muted grey (NOT white) — a neutral status must not
    // claim the accept/reject affordance.
    expect(statusColor('needs-review', 0, 0)).toBe(PALETTE.muted);
    expect(statusIcon('reviewed', 0, 0)).toBe('~');
    expect(statusColor('reviewed', 0, 0)).toBe(PALETTE.warning);
  });

  it('previewBadge returns palette hex for each annotation', () => {
    expect(previewBadge('new')).toMatchObject({ char: '+', color: PALETTE.success });
    expect(previewBadge('changed')).toMatchObject({ char: '~', color: PALETTE.warning });
    expect(previewBadge('removed')).toMatchObject({ char: '-', color: PALETTE.error, dim: true });
    expect(previewBadge('breaking')).toMatchObject({ char: '!', color: PALETTE.error, bold: true });
    expect(previewBadge(undefined)).toBeNull();
  });
});
