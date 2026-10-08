export interface PreClassification {
  category: 'content' | 'design' | 'state' | 'exclude';
  cdfTypeHint?: 'string' | 'enum' | 'richtext' | 'media' | 'boolean';
}
