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
export { stripScoringFields } from './extract/model/display.js';
export type { ExtractorOptions } from './extract/model/options.js';
export type { ComponentExtractor } from './extract/services/ports/component-extractor.js';

// Core extraction pipeline
export { extractComponents } from './extract/services/extraction-pipeline.js';
export { extractEndpoint } from './extract/controller/extract-controller.js';
export type {
  ExtractionEndpointProgress,
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from './extract/model/contract.js';

// Framework-specific extractors
export { extractReactComponents } from './extract/adapters/react/extractor.js';
export { extractVueComponents } from './extract/adapters/vue/extractor.js';
export { extractVueTsxComponents } from './extract/adapters/vue-tsx/extractor.js';
export { extractStencilComponents } from './extract/adapters/stencil/extractor.js';
export { extractAstroComponents } from './extract/adapters/astro/extractor.js';
export { extractWebComponentDefinitions } from './extract/adapters/web-components/extractor.js';
export { extractSvelteComponents } from './extract/adapters/svelte/extractor.js';
export {
  extractAllowedComponentsFromTypeText,
  extractAllowedComponentsFromJsdoc,
} from './extract/evidence/allowed-components.js';

// Post-extraction filtering and scoring
export { hasNoAuthoringSurface } from './extract/policies/quality/authorability.js';
export { computeExtractionScore, deriveNeedsReview } from './extract/policies/quality/scoring.js';
export type { ExtractionScore, ExtractionScoreOptions, ExtractionConfidence } from './extract/model/scoring.js';
export {
  inspectComponentSource,
  describeReviewReasons,
  describeReviewReason,
  isDataWrapperReviewReason,
  HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON,
  POSSIBLE_DATA_FETCH_WRAPPER_REASON,
  ZERO_SURFACE_RENDERED_UI_REASON,
} from './extract/policies/quality/source-inspection.js';
export type { ComponentSourceInspection } from './extract/policies/quality/source-inspection.js';

// Validation
export {
  validateExtractedComponents,
  shouldExcludeDueToValidation,
  formatExclusionWarning,
  formatExcludedComponentLines,
} from './extract/policies/quality/validation.js';
export { parseImportedNames } from './extract/evidence/source-evidence.js';

// Slot detection helpers
export {
  CONTENT_NAME_EXCEPTIONS,
  isReactNodeType,
  isArrayReactNodeType,
  shouldBeSlot,
} from './extract/evidence/slot-evidence.js';

// Pre-classification
export { preClassifyProp, preClassifyComponent } from './extract/services/classification-service.js';
export type { PreClassification } from './extract/services/classification-service.js';
