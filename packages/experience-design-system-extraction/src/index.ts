// Models and public contracts
export type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
  ExtractionExclusion,
  ExtractorProgress,
  ExtractionValidationIssue,
  ExtractionValidationIssueCode,
} from './extract/model/component.js';
export { stripScoringFields } from './extract/model/component.js';
export type { ExtractorOptions } from './extract/model/options.js';
export type { ComponentExtractor } from './extract/services/ports/component-extractor.js';

// Core extraction pipeline
export { extractComponents } from './extract/pipeline.js';
export { extractEndpoint } from './extract/controller/extract-controller.js';
export type {
  ExtractionEndpointProgress,
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from './extract/model/contract.js';

// Framework-specific extractors
export { extractReactComponents } from './extract/react.js';
export { extractVueComponents } from './extract/vue.js';
export { extractVueTsxComponents } from './extract/vue-tsx.js';
export { extractStencilComponents } from './extract/stencil.js';
export { extractAstroComponents } from './extract/astro.js';
export { extractWebComponentDefinitions } from './extract/web-components.js';
export { extractSvelteComponents } from './extract/svelte.js';
export {
  extractAllowedComponentsFromTypeText,
  extractAllowedComponentsFromJsdoc,
} from './extract/slot-allowed-components.js';

// Post-extraction filtering and scoring
export { isNonAuthorableComponent } from './extract/non-authorable-filter.js';
export { computeExtractionScore, deriveNeedsReview } from './extract/scoring.js';
export type { ExtractionScore, ExtractionScoreOptions, ExtractionConfidence } from './extract/model/scoring.js';
export {
  inspectComponentSource,
  describeReviewReasons,
  describeReviewReason,
  isDataWrapperReviewReason,
  HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON,
  POSSIBLE_DATA_FETCH_WRAPPER_REASON,
  ZERO_SURFACE_RENDERED_UI_REASON,
} from './extract/source-inspection.js';
export type { ComponentSourceInspection } from './extract/source-inspection.js';

// Validation
export {
  validateExtractedComponents,
  shouldExcludeDueToValidation,
  formatExclusionWarning,
  formatExcludedComponentLines,
} from './extract/validate.js';
export { parseImportedNames } from './extract/parse-imported-names.js';

// Slot detection helpers
export {
  CONTENT_NAME_EXCEPTIONS,
  isReactNodeType,
  isArrayReactNodeType,
  shouldBeSlot,
} from './extract/slot-detection.js';

// Pre-classification
export { preClassifyProp, preClassifyComponent } from './pre-classify.js';
export type { PreClassification } from './pre-classify.js';
