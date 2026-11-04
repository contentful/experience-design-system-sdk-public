import type { CompletedSharedSourceEvidence } from '../../session/repositories/db.js';
import type { ReviewComponentDetail, ReviewComponentRecord, ReviewComponentSummary } from './review-component.js';

export type ReviewSessionSnapshot = {
  components: ReviewComponentRecord[];
  /** Saved and bounded source only; absence on older snapshots is unknown. */
  sourceEvidence?: CompletedSharedSourceEvidence;
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
