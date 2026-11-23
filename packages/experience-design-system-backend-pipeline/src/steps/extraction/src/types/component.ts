import type { SourceCandidate, SourceCandidateSource } from '../candidates/types.js';

export type RawPropCategory = 'content' | 'design' | 'state';

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
  /**
   * True when extraction can prove that the prop is forwarded to the
   * same-named attribute on an intrinsic DOM element. This distinguishes
   * overloaded names such as the form attribute `name` from semantic props
   * that select visible content (for example an icon or flag name).
   */
  domAttribute?: boolean;
  category?: RawPropCategory;
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
  /**
   * Component names implied by usage evidence (a runtime type-predicate
   * function, a `.type === Component` identity check, or direct JSX
   * instantiation) rather than a declared slot contract. Kept separate from
   * `allowedComponents` so downstream provenance stays honest — this is a
   * lower-trust signal that a declared contract always overrides.
   */
  structuralAllowedComponents?: string[];
}

export interface RawComponentDefinition {
  name: string;
  source: string;
  framework: 'react' | 'next' | 'vue' | 'astro' | 'web-component' | 'stencil' | 'svelte' | 'angular';
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
  sourceCandidates?: SourceCandidate[];
  sourceCandidateSources?: SourceCandidateSource[];
  factSchemaVersion?: number;
}

export interface ComponentExtractionResult {
  compilerSources?: import('../compiler/context.js').CompilerLoadedSource[];
  sourceInventory?: import('../../source-evidence/discovery.js').SourceEvidenceInventory;
  components: RawComponentDefinition[];
  warnings: string[];
  exclusions?: ExtractionExclusion[];
  extractionDiagnostics?: import('../candidates/types.js').ExtractionDiagnostics;
}

/** A deterministic item removed before the interactive scope gate. */
export interface ExtractionExclusion {
  itemType: 'component' | 'file' | 'prop';
  name: string;
  source?: string;
  reason: string;
  stage: string;
}

export type ExtractorProgress = {
  activity?: string;
  filesProcessed: number;
  componentsFound: number;
};

/** Strip internal scoring fields before serialising a RawComponentDefinition for display or editing. */
export function stripScoringFields({
  extractionConfidence: _c,
  reviewReasons: _r,
  needsReview: _n,
  ...rest
}: RawComponentDefinition): Omit<RawComponentDefinition, 'extractionConfidence' | 'reviewReasons' | 'needsReview'> {
  return rest;
}

export type { ExtractorOptions } from './options.js';
