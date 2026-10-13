import type { CDFDocument, ServerPreviewResponse } from '@contentful/experience-design-system-types';
import type { PreviewValidationError } from '@contentful/experience-design-system-backend-pipeline';
import type { PushProgress } from '../support/push-progress.js';

/**
 * The steps of the import after the review, as the wizard had them. The ones that came before (credentials, extraction,
 * the scope gate, generation) are v2 stages of their own now.
 */
export type FlowStep =
  | 'final-review'
  | 'previewing'
  | 'preview-gate'
  | 'pushing'
  | 'path-prompt'
  | 'printing'
  | 'print-gate'
  | 'done'
  | 'error'
  | 'preview-validation-error';

export type PushResult = {
  componentTypes: { created: number; updated: number; removed: number; failed: number };
  designTokens: { created: number; updated: number; removed: number; failed: number };
  summary?: { total: number; succeeded: number; failed: number };
  failures?: Array<{ entityType: string; entityId: string; message: string }>;
};

/** Everything the flow keeps between steps. The same fields the wizard kept, minus those only the early stages used. */
export type FlowState = {
  step: FlowStep;
  agent: string;
  projectPath: string;
  outDir: string;
  rawTokensPath: string;
  tokensPath: string;
  tokenSessionId: string | null;
  tokenCount: number;
  extractSessionId: string | null;
  generateSessionId: string | null;
  generatedCount: number;
  generatedAcceptedCount: number;
  componentsPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  serverPreview: ServerPreviewResponse | null;
  cdf: CDFDocument | null;
  pushProgress: PushProgress;
  pushResult: PushResult;
  errorStep: string;
  errorMessage: string;
  errorAllowCredentialRetry: boolean;
  errorAllowBreakingChangeAcknowledgment: boolean;
  previewValidationErrors: PreviewValidationError[];
  previewValidationMissingNames: string[];
  mapTokensEligible: boolean | null;
  credentialsSkipped: boolean;
  lastRunId: string | null;
  finalizeErrorBanner: string | null;
  finalReviewPassed: boolean;
};

/** A change to the state. The steps of the flow return these instead of changing the state themselves. */
export type FlowPatch = Partial<FlowState>;

export const EMPTY_PUSH_RESULT: PushResult = {
  componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
  designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
};
