export type WizardStepAfterScope = 'credentials' | 'generating' | 'push-decision-gate' | 'print-gate';

export type WizardStepAfterCredentials = 'generating' | 'push-decision-gate';

export function nextStepAfterScopeGate(opts: { acceptedCount: number; noPush: boolean }): WizardStepAfterScope {
  if (opts.acceptedCount > 0) {
    return opts.noPush ? 'generating' : 'credentials';
  }
  return opts.noPush ? 'print-gate' : 'credentials';
}

export function nextStepAfterCredentialsValidated(opts: { acceptedCount: number }): WizardStepAfterCredentials {
  return opts.acceptedCount > 0 ? 'generating' : 'push-decision-gate';
}

export function shouldSkipFinalReviewAfterCredentials(state: {
  generateSessionId: string | null;
  finalReviewPassed: boolean;
}): boolean {
  return state.finalReviewPassed && state.generateSessionId != null;
}

export function resolveNoCacheForGenerate(opts: { isFreshSession: boolean; cliNoCache: boolean }): boolean {
  if (opts.isFreshSession) return true;
  return opts.cliNoCache;
}

export function shouldBypassPreview(state: { credentialsSkipped: boolean }): boolean {
  return state.credentialsSkipped === true;
}

export function buildSkippedPreviewTransition(): { step: 'push-decision-gate'; serverPreview: null } {
  return { step: 'push-decision-gate', serverPreview: null };
}

export function shouldRefusePush(state: { credentialsSkipped: boolean }): boolean {
  return state.credentialsSkipped === true;
}

export function buildSkippedPushTransition(): { step: 'print-gate' } {
  return { step: 'print-gate' };
}
