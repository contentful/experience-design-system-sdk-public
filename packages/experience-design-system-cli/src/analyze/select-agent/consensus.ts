export type SelectionDecision = 'accepted' | 'rejected' | 'needs-review';

export type SelectionVote = {
  attempt: number;
  decision: 'accepted' | 'rejected' | null;
  reason?: string;
  confidence?: number;
  error?: string;
};

export type SelectionContextSummary = {
  boundaryRoot: string;
  siblingFileCount: number;
  resolverReferenceCount: number;
  hasParentUsageSite: boolean;
};

export type SelectionAudit = {
  strategy: 'single-pass' | 'multi-vote-consensus';
  voteCount: number;
  acceptedVotes: number;
  rejectedVotes: number;
  failedVotes: number;
  finalDecision: SelectionDecision;
  winningReason?: string;
  votes: SelectionVote[];
  contextSummary?: SelectionContextSummary;
};

export type ConsensusResult = {
  decision: SelectionDecision;
  audit: SelectionAudit;
  failed: boolean;
};

export const DEFAULT_REVIEW_VOTE_COUNT = 5;

function preferredReason(votes: SelectionVote[], decision: 'accepted' | 'rejected'): string | undefined {
  const candidates = votes.filter((vote) => vote.decision === decision && vote.reason);
  if (candidates.length === 0) return undefined;

  const ranked = new Map<string, { count: number; bestConfidence: number }>();
  for (const vote of candidates) {
    const reason = vote.reason!;
    const entry = ranked.get(reason) ?? { count: 0, bestConfidence: 0 };
    entry.count += 1;
    entry.bestConfidence = Math.max(entry.bestConfidence, vote.confidence ?? 0);
    ranked.set(reason, entry);
  }

  return [...ranked.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return b[1].bestConfidence - a[1].bestConfidence;
  })[0]?.[0];
}

function decideFromVotes(votes: SelectionVote[], acceptedVotes: number, rejectedVotes: number): SelectionDecision {
  if (votes.length === 1) {
    if (acceptedVotes === 1) return 'accepted';
    if (rejectedVotes === 1) return 'rejected';
    return 'needs-review';
  }

  // A 3-2 split is still too unstable for auto-selection.
  if (
    votes.length >= DEFAULT_REVIEW_VOTE_COUNT &&
    ((acceptedVotes === 3 && rejectedVotes === 2) || (acceptedVotes === 2 && rejectedVotes === 3))
  ) {
    return 'needs-review';
  }

  if (acceptedVotes > rejectedVotes) return 'accepted';
  if (rejectedVotes > acceptedVotes) return 'rejected';
  return 'needs-review';
}

export function summarizeSelectionVotes(
  votes: SelectionVote[],
  contextSummary?: SelectionContextSummary,
): ConsensusResult {
  const acceptedVotes = votes.filter((vote) => vote.decision === 'accepted').length;
  const rejectedVotes = votes.filter((vote) => vote.decision === 'rejected').length;
  const failedVotes = votes.filter((vote) => vote.decision === null).length;
  const decision = decideFromVotes(votes, acceptedVotes, rejectedVotes);

  const winningReason =
    decision === 'accepted' || decision === 'rejected' ? preferredReason(votes, decision) : undefined;

  return {
    decision,
    failed: failedVotes === votes.length,
    audit: {
      strategy: votes.length === 1 ? 'single-pass' : 'multi-vote-consensus',
      voteCount: votes.length,
      acceptedVotes,
      rejectedVotes,
      failedVotes,
      finalDecision: decision,
      winningReason,
      votes,
      contextSummary,
    },
  };
}
