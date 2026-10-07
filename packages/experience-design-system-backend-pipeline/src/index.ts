// Extraction
export { extractComponents } from './steps/step-1-extraction/src/controller/extract-components-endpoint.js';
export type {
  ExtractComponentsRequest,
  ExtractComponentsResponse,
  ExtractionEndpointProgress,
} from './steps/step-1-extraction/src/types/contract.js';

// Composition
export { composeComponents } from './steps/step-2-composition/src/controller/compose-components-endpoint.js';
export type {
  ComposeComponentsRequest,
  ComposeComponentsResponse,
} from './steps/step-2-composition/src/types/contract.js';
export type { CompositionEdge, EdgeProvenance } from './steps/step-2-composition/src/helpers/interchange-schema.js';
export type { MergeResult, EdgeConflict } from './steps/step-2-composition/src/helpers/merge-edges.js';
export type { SelectedCandidate } from './steps/step-2-composition/src/types/contract.js';
export {
  selectCandidateFiles,
  capCandidatesToPromptBudget,
} from './steps/step-2-composition/src/helpers/candidate-files.js';
export { collectManifestDocEdges } from './steps/step-2-composition/src/helpers/manifest-doc-evidence.js';
export { mergeEdges } from './steps/step-2-composition/src/helpers/merge-edges.js';
export { parseMapEdges } from './steps/step-2-composition/src/helpers/parse-map-edges.js';
export { applyCompositionEdges } from './steps/step-2-composition/src/helpers/apply-mapping.js';
export { buildCompositionInputHash } from './steps/step-2-composition/src/helpers/composition-cache-key.js';

// Selection
export { selectComponents } from './steps/step-3-selection/src/controller/select-components-endpoint.js';
export type {
  SelectComponentsEndpointRequest,
  SelectComponentsEndpointResponse,
  ComponentSelection,
  SelectionServiceResult,
} from './steps/step-3-selection/src/types/contract.js';

// Generation
export { generateCdfComponents } from './steps/step-4-generation/src/controller/generate-cdf-components-endpoint.js';
export type {
  GenerateCdfComponentsRequest,
  GenerateCdfComponentsResponse,
  CdfGenerationFailure,
} from './steps/step-4-generation/src/types/contract.js';

// Apply
export { applyComponents } from './steps/step-5-apply/src/controller/apply-components-endpoint.js';
export type {
  ApplyEndpointRequest,
  ApplyEndpointResponse,
  ApplyCredentials,
  ApplyPreviewResult,
  ApplySuccessResult,
  ApplyNoChangesResult,
  BuildPostPushUrlInput,
  PostPushView,
  WriteResult,
} from './steps/step-5-apply/src/types/contract.js';
export { hasBreakingChangesWithImpact } from './steps/step-5-apply/src/helpers/has-breaking-changes.js';
export { isEmptyPreview } from './steps/step-5-apply/src/helpers/is-empty-preview.js';
export { buildPostPushUrl } from './steps/step-5-apply/src/helpers/contentful-urls.js';
export { ApiError } from './steps/step-5-apply/src/types/api-error.js';
export type { PreviewValidationError } from './steps/step-5-apply/src/types/contract.js';
export { parsePreviewValidationErrors } from './steps/step-5-apply/src/helpers/parse-preview-errors.js';
export { toApiHost, toConfiguredHost } from './steps/step-5-apply/src/helpers/host-utils.js';

// Persistence
export { collectFiles, openSession, generateSessionId } from './persistence/index.js';
export type { OpenSessionOptions, SelectionDecision, SessionHandle } from './persistence/index.js';

// Shared
export type { CandidateFile } from './steps/shared/types.js';
