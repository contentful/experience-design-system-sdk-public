export type {
  ReviewComponentStatus,
  GeneratedReviewEntry as CdfReviewEntry,
  ReviewToken as TokenReviewToken,
} from '@contentful/experience-design-system-backend-pipeline';

export type ReviewPanel = 'none' | 'prop-rationale' | 'component-rationale' | 'source' | 'token-review';

export type TokenPropSuggestion = {
  propName: string;
  kinds: string[];
  paths: string[];
  suggested: string[];
  allowed: string[];
};

export type PreviewAnnotation = 'new' | 'changed' | 'removed' | 'breaking';
