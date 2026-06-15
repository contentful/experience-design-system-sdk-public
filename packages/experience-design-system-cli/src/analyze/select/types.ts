import type { RawComponentDefinition } from '../../types.js';

export type PreviewAnnotation = 'new' | 'changed' | 'removed' | 'breaking';

export type ReviewComponentStatus = 'needs-review' | 'reviewed' | 'accepted' | 'rejected';

export type ReviewComponentRecord = {
  id: string;
  name: string;
  resolvedSourcePath: string;
  sourceCode: string | null;
  originalProposal: RawComponentDefinition;
  editedProposal: RawComponentDefinition;
  status: ReviewComponentStatus;
};

export type ReviewComponentDetail = {
  id: string;
  name: string;
  originalProposal: RawComponentDefinition;
  editedProposal: RawComponentDefinition;
  status: ReviewComponentStatus;
};

export type ReviewComponentSummary = {
  id: string;
  name: string;
  status: ReviewComponentStatus;
  previewAnnotation?: PreviewAnnotation;
  extractionConfidence: number | null; // 1–5 scale; null = not yet scored
  needsReview: boolean;
  validationErrorCount: number;
  validationWarningCount: number;
};

export type ReviewSessionSnapshot = {
  components: ReviewComponentRecord[];
};

export type ReviewSessionDetail = {
  components: ReviewComponentDetail[];
};

export type ReviewSessionSummary = {
  components: ReviewComponentSummary[];
};

export type ReviewEvent = {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type ReviewSessionPaths = {
  sessionDir: string;
  eventsPath: string;
  statePath: string;
};

export function countValidationIssues(component: RawComponentDefinition): {
  errors: number;
  warnings: number;
} {
  const issues = component.validationIssues ?? [];
  let errors = 0;
  let warnings = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errors++;
    else if (issue.severity === 'warning') warnings++;
  }
  return { errors, warnings };
}

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
