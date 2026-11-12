import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { GenerationIssue } from '@contentful/experience-design-system-types/handoff';
import type { StoredSlotCycle } from '../../persistence/src/index.js';
import type { ReviewComponentStatus } from '../../persistence/src/review-session/types/review-component.js';

export type GeneratedReviewEntry = {
  key: string;
  entry: CDFComponentEntry;
  status: ReviewComponentStatus;
  generationError?: string;
};

export type ReviewToken = { path: string; kind: string };

export type GeneratedReviewSession = {
  entries: GeneratedReviewEntry[];
  tokens: ReviewToken[];
  error: string | null;
  slotCycles: StoredSlotCycle[];
};

export type LoadGeneratedReviewSessionOptions = {
  extractSessionId: string;
  tokenSessionId?: string | null;
  generationIssues?: readonly GenerationIssue[];
};

export type ReviewFinalizeCounts = { accepted: number; rejected: number; unresolved: number };
