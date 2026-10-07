// Extraction
export { extractComponents } from './steps/extraction/controller/extract-components-endpoint.js';
export type {
  ExtractComponentsRequest,
  ExtractComponentsResponse,
  ExtractionEndpointProgress,
} from './steps/extraction/types/contract.js';

// Composition
export { composeComponents } from './steps/composition/controller/compose-components-endpoint.js';
export type { ComposeComponentsRequest, ComposeComponentsResponse } from './steps/composition/types/contract.js';
export type { CompositionEdge, EdgeProvenance } from './steps/composition/helpers/interchange-schema.js';
export type { MergeResult, EdgeConflict } from './steps/composition/helpers/merge-edges.js';
export type { SelectedCandidate } from './steps/composition/types/contract.js';
export { selectCandidateFiles, capCandidatesToPromptBudget } from './steps/composition/helpers/candidate-files.js';
export { collectManifestDocEdges } from './steps/composition/helpers/manifest-doc-evidence.js';
export { mergeEdges } from './steps/composition/helpers/merge-edges.js';
export { parseMapEdges } from './steps/composition/helpers/parse-map-edges.js';
export { applyCompositionEdges } from './steps/composition/helpers/apply-mapping.js';
export { buildCompositionInputHash } from './steps/composition/helpers/composition-cache-key.js';

// Selection
export { selectComponents } from './steps/selection/controller/select-components-endpoint.js';
export type {
  SelectComponentsEndpointRequest,
  SelectComponentsEndpointResponse,
  ComponentSelection,
  SelectionServiceResult,
} from './steps/selection/types/contract.js';

// Generation
export { generateCdfComponents } from './steps/generation/controller/generate-cdf-components-endpoint.js';
export type {
  GenerateCdfComponentsRequest,
  GenerateCdfComponentsResponse,
  CdfGenerationFailure,
} from './steps/generation/types/contract.js';

// Apply
export { applyComponents } from './steps/apply/controller/apply-components-endpoint.js';
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
} from './steps/apply/types/contract.js';
export { hasBreakingChangesWithImpact } from './steps/apply/helpers/has-breaking-changes.js';
export { isEmptyPreview } from './steps/apply/helpers/is-empty-preview.js';
export { buildPostPushUrl } from './steps/apply/helpers/contentful-urls.js';
export { ApiError } from './steps/apply/types/api-error.js';
export type { PreviewValidationError } from './steps/apply/types/contract.js';
export { parsePreviewValidationErrors } from './steps/apply/helpers/parse-preview-errors.js';
export { toApiHost, toConfiguredHost } from './steps/apply/helpers/host-utils.js';

// Persistence
export { collectFiles, openSession, generateSessionId } from './persistence/index.js';
export type { OpenSessionOptions, SelectionDecision, SessionHandle } from './persistence/index.js';

// Shared
export type { CandidateFile } from './steps/shared/types.js';
