import { access, readFile } from 'node:fs/promises';
import type { ExtractionValidationIssue } from '../../../../../steps/extraction/src/types/component.js';
import type { PreviewValidationError } from '../../../../apply/src/types/contract.js';
import { ensureRefineSession } from '../../../../../persistence/review-session/ensure-review-session.js';
import { getRefineArtifactsRoot } from '../../../../../persistence/review-session/paths/review-artifacts-root.js';
import { getRefineSessionPaths } from '../../../../../persistence/review-session/paths/review-session-paths.js';
import { saveReviewState } from '../../../../../persistence/review-session/save-review-state.js';
import type { ReviewSessionSnapshot } from '../../../../../persistence/review-session/types/review-session.js';
import { loadAndValidateForReview } from './load-and-validate-for-review.js';

/**
 * Synthesize SERVER_VALIDATION_FAILED issues onto the review state file's
 * matching components for the wizard's 422 recovery path.
 */
export async function mergePreviewValidationErrorsIntoReviewSession(
  sessionId: string,
  errors: PreviewValidationError[],
  opts: { artifactsRoot?: string } = {},
): Promise<{ patchedNames: string[]; missingNames: string[] }> {
  const artifactsRoot = opts.artifactsRoot ?? getRefineArtifactsRoot();
  const paths = await getRefineSessionPaths(sessionId, artifactsRoot);

  let snapshot: ReviewSessionSnapshot;
  try {
    await access(paths.statePath);
    snapshot = JSON.parse(await readFile(paths.statePath, 'utf8')) as ReviewSessionSnapshot;
  } catch {
    snapshot = await loadAndValidateForReview(sessionId, undefined);
    snapshot = await ensureRefineSession(sessionId, artifactsRoot, snapshot);
  }

  const errorsByName = new Map<string, PreviewValidationError[]>();
  for (const err of errors) {
    const list = errorsByName.get(err.componentName) ?? [];
    list.push(err);
    errorsByName.set(err.componentName, list);
  }

  const patchedNames: string[] = [];
  const knownNames = new Set(snapshot.components.map((c) => c.name));
  const components = snapshot.components.map((c) => {
    const matched = errorsByName.get(c.name);
    if (!matched || matched.length === 0) return c;
    patchedNames.push(c.name);
    const newIssues: ExtractionValidationIssue[] = matched.map((err) => ({
      severity: 'error',
      code: 'SERVER_VALIDATION_FAILED',
      message: err.message,
    }));
    const existing = c.originalProposal.validationIssues ?? [];
    return {
      ...c,
      originalProposal: {
        ...c.originalProposal,
        validationIssues: [...existing, ...newIssues],
      },
    };
  });

  const missingNames = [...errorsByName.keys()].filter((n) => !knownNames.has(n));
  await saveReviewState(paths.statePath, { ...snapshot, components });
  return { patchedNames, missingNames };
}
