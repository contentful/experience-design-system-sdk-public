export function shouldGenerateAfterScopeGate(opts: { acceptedCount: number }): boolean {
  return opts.acceptedCount > 0;
}

export function shouldGenerateAfterCredentialsValidated(opts: { acceptedCount: number }): boolean {
  return opts.acceptedCount > 0;
}

export function shouldSkipFinalReviewAfterCredentials(state: {
  generateSessionId: string | null;
  finalReviewPassed: boolean;
}): boolean {
  return state.finalReviewPassed && state.generateSessionId != null;
}

export function shouldBypassPreview(state: { credentialsSkipped: boolean }): boolean {
  return state.credentialsSkipped === true;
}

export function buildSkippedPreviewTransition(): { step: 'done'; serverPreview: null } {
  return { step: 'done', serverPreview: null };
}

export type CycleGateAction = 'block' | 'proceed';

export function resolveCycleGateAction(opts: { hasCycles: boolean }): CycleGateAction {
  if (!opts.hasCycles) return 'proceed';
  return 'block';
}

export function shouldRefusePush(state: { credentialsSkipped: boolean }): boolean {
  return state.credentialsSkipped === true;
}

export function buildSkippedPushTransition(): { step: 'print-gate' } {
  return { step: 'print-gate' };
}
