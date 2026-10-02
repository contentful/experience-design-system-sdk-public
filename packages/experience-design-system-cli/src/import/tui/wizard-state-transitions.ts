export type WizardStepAfterScope = 'generating' | 'push-decision-gate';

export type WizardStepAfterCredentials = 'generating' | 'push-decision-gate';

export function nextStepAfterScopeGate(opts: { acceptedCount: number }): WizardStepAfterScope {
  if (opts.acceptedCount > 0) return 'generating';
  return 'push-decision-gate';
}

export function nextStepAfterCredentialsValidated(opts: { acceptedCount: number }): WizardStepAfterCredentials {
  return opts.acceptedCount > 0 ? 'generating' : 'push-decision-gate';
}

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

export function resolveNoCacheForGenerate(opts: { cliNoCache: boolean }): boolean {
  return opts.cliNoCache;
}

export function shouldBypassPreview(state: { credentialsSkipped: boolean }): boolean {
  return state.credentialsSkipped === true;
}

export function buildSkippedPreviewTransition(): { step: 'print-gate'; serverPreview: null } {
  return { step: 'print-gate', serverPreview: null };
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
