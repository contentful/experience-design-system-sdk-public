import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';

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
  extractionConfidence: number | null;
  needsReview: boolean;
  validationErrorCount: number;
  validationWarningCount: number;
};
