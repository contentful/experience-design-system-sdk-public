export interface AutoRejectDecisionInput {
  loading: boolean;
  autoRejectFired: boolean;
  hasCycle: boolean;
}

export type AutoRejectDecision = 'fire' | 'skip';

export function computeAutoRejectDecision(input: AutoRejectDecisionInput): AutoRejectDecision {
  if (input.loading) return 'skip';
  if (input.autoRejectFired) return 'skip';
  if (!input.hasCycle) return 'skip';
  return 'fire';
}
