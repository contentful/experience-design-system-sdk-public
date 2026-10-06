// Composition
export {
  resolveComposition,
  type ResolveCompositionEndpointRequest,
  type ResolveCompositionEndpointResponse,
} from './composition/controller/resolve-composition-endpoint.js';
export type { CompositionOrchestratorRequest, CompositionOrchestratorResult } from './composition/orchestrator/execute-composition-orchestrator.js';
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
export {
  selectComponents,
  type SelectComponentsEndpointRequest,
  type SelectComponentsEndpointResponse,
} from './selection/controller/select-components-endpoint.js';
export type { SelectionOrchestratorRequest, SelectionOrchestratorResult } from './selection/orchestrator/execute-selection-orchestrator.js';
export type { ComponentSelection, SelectionServiceResult } from './selection/types/contract.js';

// Apply
export {
  applyComponents,
  type ApplyEndpointRequest,
  type ApplyEndpointResponse,
} from './apply/controller/apply-components-endpoint.js';
export type { ApplyCredentials, ApplyPreviewResult, ApplySuccessResult, ApplyNoChangesResult } from './apply/types/contract.js';
export { hasBreakingChangesWithImpact } from './apply/helpers/has-breaking-changes.js';
export { buildPostPushUrl } from './apply/helpers/contentful-urls.js';
export { toApiHost, toConfiguredHost } from './apply/helpers/host-utils.js';
