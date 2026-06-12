import type { DesignTokenType } from '@contentful/experience-design-system-types';

export type ExtractionValidationIssueCode =
  | 'EMPTY_COMPONENT_NAME'
  | 'EMPTY_PROP_NAME'
  | 'EMPTY_SLOT_NAME'
  | 'PROP_SLOT_NAME_COLLISION'
  | 'DUPLICATE_COMPONENT_NAME'
  | 'EMPTY_COMPONENT'
  | 'SERVER_VALIDATION_FAILED';

export type ExtractionValidationIssue = {
  severity: 'error' | 'warning';
  code: ExtractionValidationIssueCode;
  message: string;
  field?: string;
};

export interface RawTokenDefinition {
  name: string;
  value: string;
  source: 'css' | 'tailwind' | 'style-dictionary';
  inferredKind: DesignTokenType | string;
  ambiguous: boolean;
}

export interface RawPropDefinition {
  name: string;
  type: string;
  required: boolean;
  category?: 'content' | 'design' | 'state';
  defaultValue?: string;
  allowedValues?: string[];
  description?: string;
  tokenReference?: string;
}

export interface RawSlotDefinition {
  name: string;
  isDefault: boolean;
  description?: string;
  allowedComponents?: string[];
}

export interface RawComponentDefinition {
  name: string;
  source: string;
  framework: 'react' | 'next' | 'vue' | 'astro' | 'web-component' | 'stencil';
  props: RawPropDefinition[];
  slots: RawSlotDefinition[];
  /**
   * True when the source file declaring this component calls
   * React.createContext / createContext. Used downstream to filter
   * non-authorable context-provider components.
   */
  usesCreateContext?: boolean;
  extractionConfidence?: number | null; // 1–5 scale; null = not yet scored
  reviewReasons?: string[];
  needsReview?: boolean;
  validationIssues?: ExtractionValidationIssue[];
}

export interface ComponentExtractionResult {
  components: RawComponentDefinition[];
  warnings: string[];
}

export type ExtractorProgress = {
  filesProcessed: number;
  componentsFound: number;
};

export interface ComponentExtractor {
  name: string;
  fileFilter: (filePath: string) => boolean;
  extract(filePaths: string[], onProgress?: (p: ExtractorProgress) => void): Promise<ComponentExtractionResult>;
}

export interface TokenExtractor {
  name: string;
  extract(projectRoot: string): Promise<RawTokenDefinition[]>;
}

/** Strip internal scoring fields before serialising a RawComponentDefinition for display or editing. */
export function stripScoringFields({
  extractionConfidence: _c,
  reviewReasons: _r,
  needsReview: _n,
  ...rest
}: RawComponentDefinition): Omit<RawComponentDefinition, 'extractionConfidence' | 'reviewReasons' | 'needsReview'> {
  return rest;
}
