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

// Composition — graph & cycle analysis (operates on the composed-component graph)
export { buildComponentGraph } from './steps/composition/src/controller/build-component-graph.js';
export { findSlotCycles } from './steps/composition/src/controller/find-slot-cycles.js';
export { groupNodesByCycleMembership } from './steps/composition/src/controller/group-nodes-by-cycle-membership.js';
export { expandSeedsToIncludeCycleGroups } from './steps/composition/src/controller/expand-seeds-to-include-cycle-groups.js';
export { selectDescendantsRespectingCycles } from './steps/composition/src/controller/select-descendants-respecting-cycles.js';
export { rejectAncestorsRespectingCycles } from './steps/composition/src/controller/reject-ancestors-respecting-cycles.js';
export { selectAllDescendants } from './steps/composition/src/controller/select-all-descendants.js';
export { rejectAllAncestors } from './steps/composition/src/controller/reject-all-ancestors.js';
export { expandMatchesByOneHop } from './steps/composition/src/controller/expand-matches-by-one-hop.js';
export { findAllParents } from './steps/composition/src/controller/find-all-parents.js';
export { propagateDescendantIssuesToAncestors } from './steps/composition/src/controller/propagate-descendant-issues-to-ancestors.js';
export { findWorstIssuedDescendant } from './steps/composition/src/controller/find-worst-issued-descendant.js';
export { suggestCycleBreakEdge } from './steps/composition/src/helpers/suggest-cycle-break-edge.js';
export { formatCyclePath } from './steps/composition/src/helpers/format-cycle-path.js';
export { formatCyclePathSegments } from './steps/composition/src/helpers/format-cycle-path-segments.js';
export type {
  ComponentGraphNode,
  ComponentGraphInput,
  SlotEdge,
  SlotCycle,
  CyclePathSegment,
  CycleAwareRejectResult,
  NodeStatus,
  RenderStatus,
  Closure,
  ClosureNode,
} from './steps/composition/src/types/graph.js';

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

// Apply — pre-apply validation gates
export { detectSlotCycles } from './steps/apply/src/controller/detect-slot-cycles.js';
export { assertNoSlotCycles } from './steps/apply/src/controller/assert-no-slot-cycles.js';
export { assertNoUnresolvedSlotReferences } from './steps/apply/src/controller/assert-no-unresolved-slot-references.js';
export { formatSlotCycleReport } from './steps/apply/src/controller/format-slot-cycle-report.js';
export { formatUnresolvedSlotReferences } from './steps/apply/src/controller/format-unresolved-slot-references.js';

// Apply — inline CDF mutation (final-review edits)
export {
  applyComponentPatch,
  type ComponentPatchOperation,
} from './steps/apply/src/controller/apply-component-patch.js';
export { applyDotPath } from './steps/apply/src/controller/apply-dot-path.js';
export { warnOnUnknownPatchComponents } from './steps/apply/src/controller/warn-on-unknown-patch-components.js';

// Apply — preview output transforms
export { annotatePreview, type PreviewAnnotation } from './steps/apply/src/controller/annotate-preview.js';

// Apply — server error parsing
export { parseEdsiError, type ParsedEdsiError } from './steps/apply/src/controller/parse-edsi-error.js';
export { formatEdsiError } from './steps/apply/src/controller/format-edsi-error.js';
export { formatApiError, type ApiErrorLike } from './steps/apply/src/controller/format-api-error.js';
export { stripLambdaLogPrefix } from './steps/apply/src/helpers/edsi-errors/strip-lambda-log-prefix.js';

// Apply — token file reading
export { readTokensFromPath } from './steps/apply/src/controller/read-tokens-from-path.js';

// Agents — resolution + prompt overrides + user agent + output formatter
export {
  parseAgentModel,
  type ParsedAgentModel,
  resolveAgent,
  resolveModel,
  parsePromptOverrides,
  type PromptOverride,
  type ParsePromptOverridesResult,
  resolvePromptOverride,
  looksLikePath,
  buildUserAgent,
  invokeAgentWithOutput,
  type InvokeAgentWithOutputResult,
  OutputFormatter,
  formatToolCall,
} from './agents/index.js';

// Generation — Contentful Management client factory
export { buildContentfulManagementClient } from './steps/generation/src/controller/client/build-contentful-management-client.js';

// Generation — existing-entities fetch, read, summarize
export { fetchAndPersistExistingContentfulEntities } from './steps/generation/src/controller/existing-entities/fetch-and-persist.js';
export type {
  FetchAndPersistExistingEntitiesRequest,
  FetchAndPersistResult,
  FetchAndPersistSuccess,
  FetchAndPersistFailure,
} from './steps/generation/src/controller/existing-entities/fetch-and-persist.js';
export { readExistingContentfulEntitiesFromSession } from './steps/generation/src/controller/existing-entities/read-from-session.js';
export { summarizeForSelect } from './steps/generation/src/controller/existing-entities/summarize-for-select.js';
export { summarizeForGenerate } from './steps/generation/src/controller/existing-entities/summarize-for-generate.js';
export { summarizeForMapTokens } from './steps/generation/src/controller/existing-entities/summarize-for-map-tokens.js';
export type { ExistingContentfulEntities } from './steps/generation/src/types/existing-entities.js';
export type {
  SelectAgentSummary,
  GenerateAgentSummary,
  MapTokensSummary,
} from './steps/generation/src/types/summaries.js';

// Generation — token-default resolution (pre-step for map-tokens)
export { resolveTokenDefaults } from './steps/generation/src/controller/token-defaults/resolve-token-defaults.js';
export type {
  RawDesignTokenDefault,
  DTCGTokenLeaf,
  ResolveTokenDefaultsResult,
} from './steps/generation/src/types/token-defaults.js';

// Generation — fuzzy match (public for TUI's reject dialog)
export { findNearlyMatchingComponent } from './steps/generation/src/helpers/existing-entities/find-nearly-matching-component.js';

// Persistence
export { collectFiles, openSession, generateSessionId } from './persistence/index.js';
export type { OpenSessionOptions, SelectionDecision, SessionHandle } from './persistence/index.js';

// Shared
export type { CandidateFile } from './steps/shared/index.js';
