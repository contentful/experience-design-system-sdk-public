import { describe, expect, it } from 'vitest';
import { isAiFlagged } from '../../../src/tui/import/steps/07-scope-gate/sidebar/ai-flag.js';

describe('scope gate AI flag policy', () => {
  it.each([
    { aiDecision: 'accepted', flagged: false },
    { aiDecision: 'rejected', flagged: true },
    { aiDecision: 'failed', flagged: true },
    { aiDecision: null, flagged: false },
    { aiDecision: undefined, flagged: false },
  ] as const)('flags $aiDecision according to the AI decision alone', ({ aiDecision, flagged }) => {
    for (const needsReview of [true, false]) {
      const row = { aiDecision, needsReview };
      expect(isAiFlagged(row)).toBe(flagged);
    }
  });

  it('does not flag a row without an AI decision', () => {
    expect(isAiFlagged({})).toBe(false);
  });
});
