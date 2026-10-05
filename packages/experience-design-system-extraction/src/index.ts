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
} from './extract/types/component.js';
export { stripScoringFields } from './extract/types/display.js';
export type { ExtractorOptions } from './extract/types/options.js';
export type { ComponentExtractor } from './extract/types/component-extractor.js';

// Core extraction pipeline
export { extractComponents } from './extract/services/extraction/extract-components.js';
export { extractEndpoint } from './extract/controller/extract-controller.js';
export type {
  ExtractionEndpointProgress,
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from './extract/types/contract.js';

// Framework-specific extractors
export { extractReactComponents } from './extract/framework-adapters/react/extractor.js';
export { extractVueComponents } from './extract/framework-adapters/vue/extractor.js';
export { extractVueTsxComponents } from './extract/framework-adapters/vue-tsx/extractor.js';
export { extractStencilComponents } from './extract/framework-adapters/stencil/extractor.js';
export { extractAstroComponents } from './extract/framework-adapters/astro/extractor.js';
export { extractWebComponentDefinitions } from './extract/framework-adapters/web-components/extractor.js';
export { extractSvelteComponents } from './extract/framework-adapters/svelte/extractor.js';
export {
  extractAllowedComponentsFromTypeText,
  extractAllowedComponentsFromJsdoc,
} from './extract/helpers/evidence/collect-allowed-component-names.js';

// Post-extraction filtering and scoring
export { evaluateExtractionQuality } from './extract/services/quality/evaluate-extraction-quality.js';
export { hasNoAuthoringSurface } from './extract/services/quality/helpers/authorability/evaluate-authorability.js';
// Backwards-compatible alias for callers that used the pre-refactor name
export { hasNoAuthoringSurface as isNonAuthorableComponent } from './extract/services/quality/helpers/authorability/evaluate-authorability.js';
export {
  computeExtractionScore,
  deriveNeedsReview,
} from './extract/services/quality/helpers/scoring/compute-extraction-score.js';
export type { ExtractionScore, ExtractionScoreOptions, ExtractionConfidence } from './extract/types/scoring.js';
export {
  inspectComponentSource,
  describeReviewReasons,
  describeReviewReason,
  isDataWrapperReviewReason,
  HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON,
  POSSIBLE_DATA_FETCH_WRAPPER_REASON,
  ZERO_SURFACE_RENDERED_UI_REASON,
} from './extract/services/quality/helpers/inspection/inspect-component-source.js';
export type { ComponentSourceInspection } from './extract/types/source-inspection.js';

// Validation
export {
  validateExtractedComponents,
  shouldExcludeDueToValidation,
  formatExclusionWarning,
  formatExcludedComponentLines,
} from './extract/services/quality/helpers/inspection/validate-extracted-components.js';
export { parseImportedNames } from './extract/helpers/evidence/parse-source-imports.js';

// Slot detection helpers
export {
  CONTENT_NAME_EXCEPTIONS,
  isReactNodeType,
  isArrayReactNodeType,
  shouldBeSlot,
} from './extract/helpers/evidence/detect-slot-from-prop.js';

// Pre-classification
export { preClassifyProp, preClassifyComponent } from './extract/services/classification/classify-component-props.js';
export type { PreClassification } from './extract/types/classification.js';
