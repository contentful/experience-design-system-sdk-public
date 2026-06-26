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
 *          → credentials → credential-test-gate → validating-credentials
 *          → generating → final-review → push-decision-gate → previewing
 *          → preview-gate → pushing → done
 *
 * `--no-push` short-circuits the credentials/preview/push branch — the operator
 * just wants extract + classify + final-review without ever touching Contentful.
 */

export type WizardStepAfterScope =
  | 'credentials'
  | 'generating'
  | 'push-decision-gate'
  | 'print-gate';

export type WizardStepAfterCredentials =
  | 'generating'
  | 'push-decision-gate';

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
export function nextStepAfterScopeGate(opts: {
  acceptedCount: number;
  noPush: boolean;
}): WizardStepAfterScope {
  if (opts.acceptedCount > 0) {
    return opts.noPush ? 'generating' : 'credentials';
  }
  return opts.noPush ? 'print-gate' : 'credentials';
}

/**
 * Transition target after credentials are validated (or skipped via the
 * credential-test-gate skip path). Drives the post-credentials branch:
 *   - acceptedCount > 0 → `generating` (run the generator now that creds are good)
 *   - acceptedCount === 0 → `push-decision-gate` (no components to generate;
 *     skip straight to push-decision and preview)
 */
export function nextStepAfterCredentialsValidated(opts: {
  acceptedCount: number;
}): WizardStepAfterCredentials {
  return opts.acceptedCount > 0 ? 'generating' : 'push-decision-gate';
}
