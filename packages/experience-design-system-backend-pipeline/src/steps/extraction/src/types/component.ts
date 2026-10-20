import type {
  ComponentObservationLimits,
  ComponentFactCollectors,
} from '@contentful/experience-design-system-extraction';
import type { ComponentFacts, ComponentEvidenceReadStatus } from '@contentful/experience-design-system-extraction';
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

import type {
  ExtractionDiagnostics,
  SourceCandidate,
  SourceCandidateSource,
} from '@contentful/experience-design-system-extraction';

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
  /** Optional component observations; this sidecar has an independent schema and read status. */
  componentFacts?: ComponentFacts;
  componentEvidenceReadStatus?: ComponentEvidenceReadStatus;
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
  reviewReasons?: string[];
  needsReview?: boolean;
  validationIssues?: ExtractionValidationIssue[];
  /** Absolute path to the source file this component was extracted from. Null for synthesized / multi-file. */
  sourcePath?: string;
  /** Immutable source observations kept independent of projected props and slots. */
  sourceCandidates?: SourceCandidate[];
  /** Candidate evidence from duplicate declarations; never merged into this winner's facts. */
  sourceCandidateSources?: SourceCandidateSource[];
  sourceEvidenceReadStatus?: 'available' | 'unknown-legacy' | 'corrupt' | 'unsupported';
  /** Absent legacy data is unknown; this version identifies the fact payload. */
  factSchemaVersion?: number;
}

export interface ComponentExtractionResult {
  components: RawComponentDefinition[];
  warnings: string[];
  exclusions?: ExtractionExclusion[];
  extractionDiagnostics?: ExtractionDiagnostics;
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
  filesProcessed: number;
  componentsFound: number;
};

/**
 * Optional extraction-time settings forwarded from the CLI through the
 * pipeline to each extractor; supported settings are consumed by each adapter.
 */
export interface ExtractorOptions {
  /** Optional field-local component observation collectors; overrides replace the React default field collector. */
  componentFactCollectors?: ComponentFactCollectors;
  componentObservationLimits?: Partial<ComponentObservationLimits>;
  /**
   * Whether the Svelte extractor should run a retry pass for components whose
   * declared Props type couldn't be resolved on the first pass (cross-package
   * extends, path-alias-only types, etc.). See svelte.ts for the policy.
   */
  resolveUnreachable?: 'auto' | 'always' | 'never';
  /** Absolute project root — used by the retry pass to locate tsconfig.json and node_modules. */
  projectRoot?: string;
  /** Optional cooperative cancellation for bounded compiler analysis. */
  signal?: AbortSignal;
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
