export interface PreClassification {
  category: 'content' | 'design' | 'state' | 'exclude';
  cdfTypeHint?: 'string' | 'richtext' | 'media' | 'boolean';
}

export interface PropBucketAssignment {
  component: string;
  source: string;
  customPropNames: string[];
  domPassthroughPropNames: string[];
  otherPropNames: string[];
}
