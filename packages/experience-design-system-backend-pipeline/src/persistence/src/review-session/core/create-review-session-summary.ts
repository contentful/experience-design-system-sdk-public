import { countValidationIssues } from '../helpers/count-validation-issues.js';
import type { ReviewSessionSnapshot, ReviewSessionSummary } from '../types/review-session.js';

export function createReviewSessionSummary(session: ReviewSessionSnapshot): ReviewSessionSummary {
  return {
    components: session.components.map((component) => {
      const counts = countValidationIssues(component.originalProposal);
      return {
        id: component.id,
        name: component.name,
        status: component.status,
        extractionConfidence: component.originalProposal.extractionConfidence ?? null,
        needsReview: component.originalProposal.needsReview ?? false,
        validationErrorCount: counts.errors,
        validationWarningCount: counts.warnings,
      };
    }),
  };
}
