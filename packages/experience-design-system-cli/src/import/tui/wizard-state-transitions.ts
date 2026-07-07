/**
 * Pure state-machine helpers for the wizard. Extracted from WizardApp.tsx so the
 * transitions can be unit-tested without rendering ink.
 *
 * Bug fix (2026-06): credentials moved BEFORE generate so:
 *   1. Bad creds (401/403) are caught upfront — before the operator pays the cost
 *      of extract + LLM classification (potentially many minutes).
 *   2. Live preview in final-review actually fires, because the validated creds
 *      are present in WizardApp state when GenerateReviewStep mounts.
 *
 * New order:
 *   welcome → token-input → path-validation → extracting → scope-gate
 *          → credentials (validates inline) → generating
 *          → generating → final-review → push-decision-gate → previewing
 *          → preview-gate → pushing → done
 *
 * `--no-push` short-circuits the credentials/preview/push branch — the operator
 * just wants extract + classify + final-review without ever touching Contentful.
 */

export type WizardStepAfterScope = 'credentials' | 'generating' | 'push-decision-gate' | 'print-gate';

export type WizardStepAfterCredentials = 'generating' | 'push-decision-gate';

/**
 * Transition target after the scope-gate confirms.
 *
 * - acceptedCount > 0:
 *   - !noPush → `credentials` (gather + validate creds upfront, before LLM cost)
 *   - noPush  → `generating` (skip creds entirely; live preview no-ops gracefully)
 * - acceptedCount === 0 (everything rejected):
 *   - !noPush → `credentials` (still need creds to push tokens / removals)
 *   - noPush  → `print-gate` (nothing to do; let the operator save files and exit)
 */
export function nextStepAfterScopeGate(opts: { acceptedCount: number; noPush: boolean }): WizardStepAfterScope {
  if (opts.acceptedCount > 0) {
    return opts.noPush ? 'generating' : 'credentials';
  }
  return opts.noPush ? 'print-gate' : 'credentials';
}

/**
 * Transition target after credentials are validated (or skipped via the
 * inline validation pings the API). Drives the post-credentials branch:
 *   - acceptedCount > 0 → `generating` (run the generator now that creds are good)
 *   - acceptedCount === 0 → `push-decision-gate` (no components to generate;
 *     skip straight to push-decision and preview)
 */
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

/**
 * Skip-credentials spec — Task 2. When the operator pressed `s` on the
 * credentials screen, the wizard advanced without validating creds. That
 * makes `previewImport` impossible (no working token) and undesirable (the
 * whole point is to inspect locally without touching the server). Callers
 * check this before issuing the API call and route to
 * `buildSkippedPreviewTransition()` instead.
 */
export function shouldBypassPreview(state: { credentialsSkipped: boolean }): boolean {
  return state.credentialsSkipped === true;
}

/**
 * State patch applied when `shouldBypassPreview` is true: skip the preview
 * step entirely, surface no server preview to downstream consumers, and
 * hand control to the push-decision-gate (which will render with push
 * disabled — see Task 3).
 */
export function buildSkippedPreviewTransition(): { step: 'push-decision-gate'; serverPreview: null } {
  return { step: 'push-decision-gate', serverPreview: null };
}

/**
 * Skip-credentials spec — Task 4 (defensive guard). The push-decision-gate
 * disables "Save AND push" and "Push only" when credentialsSkipped is true,
 * so `runPush` should never be reached. If a state-machine regression ever
 * routed an operator past that guard, `runPush` checks this helper and
 * refuses to issue the API call — instead it routes back to the print-files
 * local-save path via `buildSkippedPushTransition`.
 */
export function shouldRefusePush(state: { credentialsSkipped: boolean }): boolean {
  return state.credentialsSkipped === true;
}

export function buildSkippedPushTransition(): { step: 'print-gate' } {
  return { step: 'print-gate' };
}
