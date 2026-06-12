import { ApiError, parsePreviewValidationErrors, type PreviewValidationError } from '../../apply/api-client.js';
import { patchReviewStateWithValidationErrors, rejectComponentsByName } from '../../analyze/select/command.js';

export type Preview422Outcome =
  | { kind: 'validation-error'; errors: PreviewValidationError[]; missingNames: string[] }
  | { kind: 'unparseable'; message: string }
  | { kind: 'not-422' };

/**
 * Decide what to do with an `ApiError` raised by `previewImport()`.
 * Returns `not-422` if the caller should fall through to its other branches
 * (404 / 401 / 403 / generic), `unparseable` if the body cannot be parsed
 * into structured component-level errors (caller should route to the generic
 * error step), or `validation-error` with the patched-state side effects
 * already applied.
 *
 * Pure decision logic + a single delegated side effect to
 * `patchReviewStateWithValidationErrors`. Extracted from `WizardApp.runPreview`
 * so the routing is unit-testable without driving the full TUI.
 */
export async function handlePreview422(
  err: ApiError,
  extractSessionId: string | null,
  patchFn: typeof patchReviewStateWithValidationErrors = patchReviewStateWithValidationErrors,
): Promise<Preview422Outcome> {
  if (err.status !== 422) return { kind: 'not-422' };
  const errors = parsePreviewValidationErrors(err.body);
  if (errors.length === 0) return { kind: 'unparseable', message: err.message };

  let missingNames: string[] = [];
  if (extractSessionId) {
    const result = await patchFn(extractSessionId, errors);
    missingNames = result.missingNames;
  }
  return { kind: 'validation-error', errors, missingNames };
}

/**
 * Run the "skip and retry" side effect: dedup the offending component
 * names from a list of errors and call `rejectComponentsByName`. Returns
 * the deduped names so the caller can log them or include them in test
 * assertions. No-op when sessionId is null or errors are empty.
 *
 * The DB update inside `rejectComponentsByName` is what makes the next
 * preview see a manifest with the offenders excluded — see SP-3 retro
 * Bug 1: writing to the JSON state file alone is not enough because
 * `loadCDFComponents` reads from the pipeline DB.
 */
export async function applySkipValidationErrors(
  sessionId: string | null,
  errors: PreviewValidationError[],
  rejectFn: typeof rejectComponentsByName = rejectComponentsByName,
): Promise<string[]> {
  if (!sessionId) return [];
  const names = [...new Set(errors.map((e) => e.componentName))];
  if (names.length === 0) return [];
  await rejectFn(sessionId, names);
  return names;
}
