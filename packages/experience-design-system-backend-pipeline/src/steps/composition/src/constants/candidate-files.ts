export const CANDIDATE_NAME_PATTERNS: RegExp[] = [
  /mapping/i,
  /meta/i,
  /registry/i,
  /schema/i,
  /composition/i,
  /\.module\.ts$/i,
  /\.component\.ts$/i,
  /public[-_]api\.ts$/i,
  /^index\.ts$/i,
];
export const CANDIDATE_CONTENT_MARKERS: string[] = [
  'requiredParent',
  'withParentType',
  'allowedTagNames',
  'createContext',
  'MappingContext',
  'allowedComponents',
  'TemplateRef',
  'NG_VALUE_ACCESSOR',
  'ContentChild',
  'contentChild',
  'ng-content',
  '@NgModule',
  'standalone: true',
];
export const CANDIDATE_TOKEN_BUDGET = 6000;
export const PROMPT_CANDIDATE_TOKEN_BUDGET = 80_000;
