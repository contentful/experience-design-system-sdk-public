import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

export type ReviewComponentStatus = 'needs-review' | 'reviewed' | 'accepted' | 'rejected';

export type CdfReviewEntry = {
  key: string;
  componentId?: string;
  entry: CDFComponentEntry;
  status: ReviewComponentStatus;
};

export type ReviewPanel =
  | 'none'
  | 'prop-rationale'
  | 'component-rationale'
  | 'source'
  | 'token-review'
  | 'representations';

export type TokenReviewToken = { path: string; kind: string };

export type TokenPropSuggestion = {
  propName: string;
  paths: string[];
  suggested: string[];
  allowed: string[];
};

export type PreviewAnnotation = 'new' | 'changed' | 'removed' | 'breaking';
