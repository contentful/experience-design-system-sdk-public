// Composition
export { composeComponents } from './composition/controller/compose-components-endpoint.js';
export type {
  ComposeComponentsRequest,
  ComposeComponentsResponse,
} from './composition/types/contract.js';
export type { CompositionEdge, EdgeProvenance } from './composition/helpers/interchange-schema.js';
export type { MergeResult, EdgeConflict } from './composition/helpers/merge-edges.js';
export type { CandidateFile, SelectedCandidate } from './composition/helpers/candidate-files.js';
export { selectCandidateFiles, capCandidatesToPromptBudget } from './composition/helpers/candidate-files.js';
export { collectManifestDocEdges } from './composition/helpers/manifest-doc-evidence.js';
export { mergeEdges } from './composition/helpers/merge-edges.js';
export { parseMapEdges } from './composition/helpers/parse-map-edges.js';
export { applyMapping } from './composition/helpers/apply-mapping.js';
export { buildCompositionInputHash } from './composition/helpers/composition-cache-key.js';

// Selection
export { selectComponents } from './selection/controller/select-components-endpoint.js';
export type {
  SelectComponentsEndpointRequest,
  SelectComponentsEndpointResponse,
  ComponentSelection,
  SelectionServiceResult,
} from './selection/types/contract.js';

// Apply
export { applyComponents } from './apply/controller/apply-components-endpoint.js';
export type {
  ApplyEndpointRequest,
  ApplyEndpointResponse,
  ApplyCredentials,
  ApplyPreviewResult,
  ApplySuccessResult,
  ApplyNoChangesResult,
} from './apply/types/contract.js';
export { hasBreakingChangesWithImpact } from './apply/helpers/has-breaking-changes.js';
export { buildPostPushUrl } from './apply/helpers/contentful-urls.js';
export { toApiHost, toConfiguredHost } from './apply/helpers/host-utils.js';
