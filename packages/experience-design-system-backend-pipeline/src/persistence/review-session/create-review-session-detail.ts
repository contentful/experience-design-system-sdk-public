import type { ReviewSessionDetail, ReviewSessionSnapshot } from './types/review-session.js';

export function createReviewSessionDetail(session: ReviewSessionSnapshot): ReviewSessionDetail {
  return {
    components: session.components.map((component) => ({
      id: component.id,
      name: component.name,
      originalProposal: component.originalProposal,
      editedProposal: component.editedProposal,
      status: component.status,
    })),
  };
}
