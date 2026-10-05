export interface PreClassification {
  category: 'content' | 'design' | 'state' | 'exclude';
  cdfTypeHint?: 'string' | 'enum' | 'richtext' | 'media' | 'boolean';
}

export type PropBucket = 'custom' | 'dom-passthrough' | 'other';

export interface PropBucketAssignment {
  component: string;
  source: string;
  customPropNames: string[];
  domPassthroughPropNames: string[];
  otherPropNames: string[];
}
