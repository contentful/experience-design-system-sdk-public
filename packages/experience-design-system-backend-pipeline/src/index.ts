// Extraction
export { extractComponents } from './steps/extraction/src/controller/extract-components-endpoint.js';
export type {
  ExtractComponentsRequest,
  ExtractComponentsResponse,
  ExtractionEndpointProgress,
} from './steps/extraction/src/types/contract.js';

// Composition
export { composeComponents } from './steps/composition/src/controller/compose-components-endpoint.js';
export type { ComposeComponentsRequest, ComposeComponentsResponse } from './steps/composition/src/types/contract.js';
export type { CompositionEdge, EdgeProvenance } from './steps/composition/src/helpers/interchange-schema.js';
export type { MergeResult, EdgeConflict } from './steps/composition/src/helpers/merge-edges.js';
export type { SelectedCandidate } from './steps/composition/src/types/contract.js';
export { selectCandidateFiles, capCandidatesToPromptBudget } from './steps/composition/src/helpers/candidate-files.js';
export { collectManifestDocEdges } from './steps/composition/src/helpers/manifest-doc-evidence.js';
export { mergeEdges } from './steps/composition/src/helpers/merge-edges.js';
export { parseMapEdges } from './steps/composition/src/helpers/parse-map-edges.js';
export { applyCompositionEdges } from './steps/composition/src/helpers/apply-mapping.js';
export { buildCompositionInputHash } from './steps/composition/src/helpers/composition-cache-key.js';

// Selection
export { selectComponents } from './steps/selection/src/controller/select-components-endpoint.js';
export type {
  SelectComponentsEndpointRequest,
  SelectComponentsEndpointResponse,
  ComponentSelection,
  SelectionServiceResult,
} from './steps/selection/src/types/contract.js';

// Generation
export { generateCdfComponents } from './steps/generation/src/controller/generate-cdf-components-endpoint.js';
export type {
  GenerateCdfComponentsRequest,
  GenerateCdfComponentsResponse,
  CdfGenerationFailure,
} from './steps/generation/src/types/contract.js';

// Apply
export { applyComponents } from './steps/apply/src/controller/apply-components-endpoint.js';
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
} from './steps/apply/src/types/contract.js';
export { hasBreakingChangesWithImpact } from './steps/apply/src/helpers/has-breaking-changes.js';
export { isEmptyPreview } from './steps/apply/src/helpers/is-empty-preview.js';
export { buildPostPushUrl } from './steps/apply/src/helpers/contentful-urls.js';
export { ApiError } from './steps/apply/src/types/api-error.js';
export type { PreviewValidationError } from './steps/apply/src/types/contract.js';
export { parsePreviewValidationErrors } from './steps/apply/src/helpers/parse-preview-errors.js';
export { toApiHost, toConfiguredHost } from './steps/apply/src/helpers/host-utils.js';

// Persistence
export { collectFiles, openSession, generateSessionId } from './persistence/index.js';
export type { OpenSessionOptions, SelectionDecision, SessionHandle } from './persistence/index.js';

// Shared
export type { CandidateFile } from './steps/shared/types/index.js';
