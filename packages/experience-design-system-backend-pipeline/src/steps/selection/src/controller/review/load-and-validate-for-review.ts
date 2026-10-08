import { validateExtractedComponents } from '../../../../extraction/src/helpers/quality/validate.js';
import { openPipelineDb } from '../../../../../persistence/session/db.js';
import { loadRawComponents } from '../../../../../persistence/session/db.js';
import { loadReviewInput } from '../../../../../persistence/review-session/load-review-input.js';
import type { ReviewSessionSnapshot } from '../../../../../persistence/review-session/types/review-session.js';

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
