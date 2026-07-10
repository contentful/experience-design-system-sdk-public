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

export interface RawPropDefinition {
  name: string;
  type: string;
  required: boolean;
  category?: 'content' | 'design' | 'state';
  defaultValue?: string;
  allowedValues?: string[];
  description?: string;
  tokenReference?: string;
  /** 1-indexed source line where this prop's declaration begins; relative to RawComponentDefinition.source. */
  sourceStartLine?: number;
  /** 1-indexed inclusive source line where this prop's declaration ends; relative to RawComponentDefinition.source. */
  sourceEndLine?: number;
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
  framework: 'react' | 'next' | 'vue' | 'astro' | 'web-component' | 'stencil' | 'svelte';
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
  /** Absolute path to the source file this component was extracted from. Null for synthesized / multi-file. */
  sourcePath?: string;
}

export interface ComponentExtractionResult {
  components: RawComponentDefinition[];
  warnings: string[];
}

export type ExtractorProgress = {
  filesProcessed: number;
  componentsFound: number;
};

/**
 * Optional extraction-time settings forwarded from the CLI through the
 * pipeline to each extractor. Only the Svelte extractor currently consumes
 * any of these; other extractors ignore the value.
 */
export interface ExtractorOptions {
  /**
   * Whether the Svelte extractor should run a retry pass for components whose
   * declared Props type couldn't be resolved on the first pass (cross-package
   * extends, path-alias-only types, etc.). See svelte.ts for the policy.
   */
  resolveUnreachable?: 'auto' | 'always' | 'never';
  /** Absolute project root — used by the retry pass to locate tsconfig.json and node_modules. */
  projectRoot?: string;
}

export interface ComponentExtractor {
  name: string;
  fileFilter: (filePath: string) => boolean;
  extract(
    filePaths: string[],
    onProgress?: (p: ExtractorProgress) => void,
    opts?: ExtractorOptions,
  ): Promise<ComponentExtractionResult>;
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
