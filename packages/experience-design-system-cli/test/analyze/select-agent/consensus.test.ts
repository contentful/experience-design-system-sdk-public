import { describe, expect, it } from 'vitest';
import { summarizeSelectionVotes } from '../../../src/analyze/select-agent/consensus.js';

describe('selection consensus', () => {
  it('accepts a clean single-pass decision', () => {
    const result = summarizeSelectionVotes([
      {
        attempt: 1,
        decision: 'accepted',
        reason: 'visible ui component',
        confidence: 5,
      },
    ]);

    expect(result.failed).toBe(false);
    expect(result.decision).toBe('accepted');
    expect(result.audit).toMatchObject({
      strategy: 'single-pass',
      voteCount: 1,
      acceptedVotes: 1,
      rejectedVotes: 0,
      finalDecision: 'accepted',
      winningReason: 'visible ui component',
    });
  });

  it('leaves a 3-2 borderline split as needs-review', () => {
    const result = summarizeSelectionVotes([
      {
        attempt: 1,
        decision: 'accepted',
        reason: 'visible ui component',
        confidence: 4,
      },
      {
        attempt: 2,
        decision: 'accepted',
        reason: 'visible ui component',
        confidence: 4,
      },
      {
        attempt: 3,
        decision: 'accepted',
        reason: 'visible ui component',
        confidence: 3,
      },
      {
        attempt: 4,
        decision: 'rejected',
        reason: 'data-fetch wrapper',
        confidence: 5,
      },
      {
        attempt: 5,
        decision: 'rejected',
        reason: 'data-fetch wrapper',
        confidence: 5,
      },
    ]);

    expect(result.failed).toBe(false);
    expect(result.decision).toBe('needs-review');
    expect(result.audit).toMatchObject({
      strategy: 'multi-vote-consensus',
      voteCount: 5,
      acceptedVotes: 3,
      rejectedVotes: 2,
      finalDecision: 'needs-review',
    });
    expect(result.audit.winningReason).toBeUndefined();
  });

  it('rejects when the review votes converge clearly', () => {
    const result = summarizeSelectionVotes([
      {
        attempt: 1,
        decision: 'rejected',
        reason: 'data-fetch wrapper',
        confidence: 5,
      },
      {
        attempt: 2,
        decision: 'rejected',
        reason: 'data-fetch wrapper',
        confidence: 4,
      },
      {
        attempt: 3,
        decision: 'rejected',
        reason: 'data-fetch wrapper',
        confidence: 5,
      },
      {
        attempt: 4,
        decision: 'rejected',
        reason: 'data-fetch wrapper',
        confidence: 4,
      },
      {
        attempt: 5,
        decision: 'accepted',
        reason: 'visible ui component',
        confidence: 2,
      },
    ]);

    expect(result.failed).toBe(false);
    expect(result.decision).toBe('rejected');
    expect(result.audit).toMatchObject({
      strategy: 'multi-vote-consensus',
      voteCount: 5,
      acceptedVotes: 1,
      rejectedVotes: 4,
      finalDecision: 'rejected',
      winningReason: 'data-fetch wrapper',
    });
  });
});
