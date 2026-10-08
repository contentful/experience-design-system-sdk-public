import { validateExtractedComponents } from '../../../../extraction/src/helpers/quality/validate.js';
import { openPipelineDb } from '../../../../../persistence/src/session/repositories/db.js';
import { loadRawComponents } from '../../../../../persistence/src/session/repositories/db.js';
import { loadReviewInput } from '../../../../../persistence/src/review-session/core/load-review-input.js';
import type { ReviewSessionSnapshot } from '../../../../../persistence/src/review-session/types/review-session.js';

/**
 * Load components from the pipeline DB and re-run extraction validation.
 *
 * `validationIssues` is intentionally not persisted (the validator is pure
 * and cheap to re-run), so any cold-start of the review state needs to
 * recompute it before building the review snapshot.
 */
export async function loadAndValidateForReview(
  sessionId: string,
  projectRoot: string | undefined,
): Promise<ReviewSessionSnapshot> {
  const db = openPipelineDb();
  let rawComponents;
  try {
    rawComponents = loadRawComponents(db, sessionId);
  } finally {
    db.close();
  }
  const validatedComponents = validateExtractedComponents(rawComponents);
  return loadReviewInput(validatedComponents, { reviewRoot: projectRoot });
}
