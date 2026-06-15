import { describe, it, expect } from 'vitest';
import { countValidationIssues, createReviewSessionSummary } from '../../../src/analyze/select/types.js';
import type { ReviewSessionSnapshot } from '../../../src/analyze/select/types.js';
import type { RawComponentDefinition } from '../../../src/types.js';

function makeRaw(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'X',
    source: '/x',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

describe('countValidationIssues', () => {
  it('returns zeros when validationIssues is undefined', () => {
    expect(countValidationIssues(makeRaw())).toEqual({ errors: 0, warnings: 0 });
  });

  it('returns zeros when validationIssues is empty', () => {
    expect(countValidationIssues(makeRaw({ validationIssues: [] }))).toEqual({ errors: 0, warnings: 0 });
  });

  it('counts errors and warnings separately', () => {
    const c = makeRaw({
      validationIssues: [
        { severity: 'error', code: 'EMPTY_COMPONENT_NAME', message: '' },
        { severity: 'error', code: 'EMPTY_SLOT_NAME', message: '' },
        { severity: 'warning', code: 'EMPTY_COMPONENT', message: '' },
      ],
    });
    expect(countValidationIssues(c)).toEqual({ errors: 2, warnings: 1 });
  });
});

describe('createReviewSessionSummary validation counts', () => {
  function makeSnapshot(overrides: Partial<RawComponentDefinition>): ReviewSessionSnapshot {
    const raw = makeRaw(overrides);
    return {
      components: [
        {
          id: 'x-1',
          name: raw.name,
          resolvedSourcePath: '/x',
          sourceCode: null,
          originalProposal: raw,
          editedProposal: raw,
          status: 'needs-review',
        },
      ],
    };
  }

  it('populates validationWarningCount from originalProposal.validationIssues', () => {
    const snap = makeSnapshot({
      validationIssues: [
        { severity: 'warning', code: 'EMPTY_COMPONENT', message: '' },
        { severity: 'warning', code: 'EMPTY_COMPONENT', message: '' },
      ],
    });
    const summary = createReviewSessionSummary(snap);
    expect(summary.components[0].validationWarningCount).toBe(2);
    expect(summary.components[0].validationErrorCount).toBe(0);
  });

  it('populates validationErrorCount from originalProposal.validationIssues', () => {
    const snap = makeSnapshot({
      validationIssues: [{ severity: 'error', code: 'EMPTY_COMPONENT_NAME', message: '' }],
    });
    const summary = createReviewSessionSummary(snap);
    expect(summary.components[0].validationErrorCount).toBe(1);
    expect(summary.components[0].validationWarningCount).toBe(0);
  });
});
