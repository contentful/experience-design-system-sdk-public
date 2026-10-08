// Preflight env/auth checks (reads credentials + probes binaries; lives under persistence)
export * as doctor from './persistence/src/doctor/index.js';

// Generation — export CDF document / DTCG tree (reads session DB → in-memory artifacts)
export {
  exportCdfDocument,
  ExportCdfDocumentFailure,
  // legacy-name aliases
  printComponents,
  PrintComponentsFailure,
} from './steps/generation/src/controller/export/export-cdf-document.js';
export {
  exportDtcgTree,
  ExportDtcgTreeFailure,
  // legacy-name aliases
  printTokens,
  PrintTokensFailure,
} from './steps/generation/src/controller/export/export-dtcg-tree.js';
export type {
  ExportCdfDocumentRequest,
  ExportCdfDocumentResult,
  ExportCdfDocumentError,
  ExportDtcgTreeRequest,
  ExportDtcgTreeResult,
  ExportDtcgTreeError,
  // legacy-name aliases
  PrintComponentsRequest,
  PrintComponentsResult,
  PrintComponentsError,
  PrintTokensRequest,
  PrintTokensResult,
  PrintTokensError,
} from './steps/generation/src/controller/export/types-export.js';

// Shared validators (used by CLI's `print validate` command, apply pre-flight, and anywhere else)
export { validateCDFFile } from './steps/shared/cdf/validators/validate-cdf-file.js';
export { validateDTCGTokenFile } from './steps/shared/dtcg/validators/validate-dtcg-token-file.js';
export { formatDiagnostics } from './steps/shared/cdf/validators/format-diagnostics.js';
export { readJsonFile } from './steps/shared/cdf/validators/read-json-file.js';
export type { ValidationResult, ValidationDiagnostic } from './steps/shared/cdf/validators/types-validation.js';
export { rebuildDTCGTree } from './steps/shared/dtcg/helpers/rebuild-dtcg-tree.js';

// Extraction
export { extractComponents } from './steps/extraction/src/controller/extract-components-endpoint.js';
export type {
  ExtractComponentsRequest,
  ExtractComponentsResponse,
  ExtractionEndpointProgress,
} from './steps/extraction/src/types/contract.js';

// Composition
export { composeComponents } from './steps/composition/src/controller/endpoint/compose-components-endpoint.js';
export type { ComposeComponentsRequest, ComposeComponentsResponse } from './steps/composition/src/types/contract.js';
export type { CompositionEdge, EdgeProvenance } from './steps/composition/src/helpers/edges/interchange-schema.js';
export type { MergeResult, EdgeConflict } from './steps/composition/src/helpers/edges/merge-edges.js';
export type { SelectedCandidate } from './steps/composition/src/types/contract.js';
export {
  selectCandidateFiles,
  capCandidatesToPromptBudget,
} from './steps/composition/src/helpers/candidates/candidate-files.js';
export { collectManifestDocEdges } from './steps/composition/src/helpers/edges/manifest-doc-evidence.js';
export { mergeEdges } from './steps/composition/src/helpers/edges/merge-edges.js';
export { parseMapEdges } from './steps/composition/src/helpers/edges/parse-map-edges.js';
export { applyCompositionEdges } from './steps/composition/src/helpers/edges/apply-mapping.js';
export { buildCompositionInputHash } from './steps/composition/src/helpers/candidates/composition-cache-key.js';
export { resolveCompositionSources } from './steps/composition/src/helpers/edges/resolve-composition-sources.js';
export type {
  CompositionCliOptions,
  ResolvedCompositionSources,
} from './steps/composition/src/helpers/edges/resolve-composition-sources.js';

// Composition — graph & cycle analysis (operates on the composed-component graph)
export { buildComponentGraph } from './steps/composition/src/controller/graph/build-component-graph.js';
export { findSlotCycles } from './steps/composition/src/controller/cycles/find-slot-cycles.js';
export { groupNodesByCycleMembership } from './steps/composition/src/controller/cycles/group-nodes-by-cycle-membership.js';
export { expandSeedsToIncludeCycleGroups } from './steps/composition/src/controller/selection/expand-seeds-to-include-cycle-groups.js';
export { selectDescendantsRespectingCycles } from './steps/composition/src/controller/selection/select-descendants-respecting-cycles.js';
export { rejectAncestorsRespectingCycles } from './steps/composition/src/controller/selection/reject-ancestors-respecting-cycles.js';
export { selectAllDescendants } from './steps/composition/src/controller/selection/select-all-descendants.js';
export { rejectAllAncestors } from './steps/composition/src/controller/selection/reject-all-ancestors.js';
export { expandMatchesByOneHop } from './steps/composition/src/controller/graph/expand-matches-by-one-hop.js';
export { findAllParents } from './steps/composition/src/controller/graph/find-all-parents.js';
export { propagateDescendantIssuesToAncestors } from './steps/composition/src/controller/selection/propagate-descendant-issues-to-ancestors.js';
export { findWorstIssuedDescendant } from './steps/composition/src/controller/selection/find-worst-issued-descendant.js';
export { suggestCycleBreakEdge } from './steps/composition/src/helpers/cycles/suggest-cycle-break-edge.js';
export { formatCyclePath } from './steps/composition/src/helpers/cycles/format-cycle-path.js';
export { formatCyclePathSegments } from './steps/composition/src/helpers/cycles/format-cycle-path-segments.js';
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

// Selection — human-review controllers (bridge DB + review-session files)
export { loadAndValidateForReview } from './steps/selection/src/controller/review/load-and-validate-for-review.js';
export { mergePreviewValidationErrorsIntoReviewSession } from './steps/selection/src/controller/review/merge-preview-validation-errors-into-review-session.js';
// Legacy-name alias used by cli-legacy wizard-422-helpers
export { mergePreviewValidationErrorsIntoReviewSession as patchReviewStateWithValidationErrors } from './steps/selection/src/controller/review/merge-preview-validation-errors-into-review-session.js';
export { rejectComponentsByName } from './steps/selection/src/controller/review/reject-components-by-name.js';

// Review-session file I/O (used by TUI directly)
export {
  getRefineArtifactsRoot,
  getRefineSessionPaths,
  saveReviewState,
  appendReviewEvent,
  ensureRefineSession,
  loadReviewInput,
  createReviewSessionSummary,
  createReviewSessionDetail,
  countValidationIssues,
  writeScopeDecisionsSnapshot,
} from './persistence/src/index.js';
export type {
  LoadReviewInputOptions,
  ReviewComponentStatus,
  ReviewComponentRecord,
  ReviewComponentDetail,
  ReviewComponentSummary,
  ReviewSessionSnapshot,
  ReviewSessionDetail,
  ReviewSessionSummary,
  ReviewEvent,
  ReviewSessionPaths,
} from './persistence/src/index.js';

// Generation
export { generateCdfComponents } from './steps/generation/src/controller/generate-cdf-components-endpoint.js';
export type {
  GenerateCdfComponentsRequest,
  GenerateCdfComponentsResponse,
  CdfGenerationFailure,
} from './steps/generation/src/types/contract.js';

// Apply
export { applyComponents } from './steps/apply/src/controller/endpoint/apply-components-endpoint.js';
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
export { toCdfTokens, toCdfTokens as toCDFTokens } from './steps/apply/src/helpers/token-utils.js';
export { isEmptyPreview } from './steps/apply/src/helpers/is-empty-preview.js';
export { buildPostPushUrl } from './steps/apply/src/helpers/contentful-urls.js';
export { ApiError } from './steps/apply/src/types/api-error.js';
export { ApiClient } from './steps/apply/src/helpers/api-client/api-client.js';
// Legacy-name alias used by cli-legacy apply command
export { ApiClient as ImportApiClient } from './steps/apply/src/helpers/api-client/api-client.js';
export type { ApiClientOptions, RetryConfig } from './steps/apply/src/types/contract.js';
export type { PreviewValidationError } from './steps/apply/src/types/contract.js';
export { parsePreviewValidationErrors } from './steps/apply/src/helpers/parse-preview-errors.js';
export { toApiHost, toConfiguredHost } from './steps/apply/src/helpers/host-utils.js';

// Apply — pre-apply validation gates
export { detectSlotCycles } from './steps/apply/src/controller/validation/detect-slot-cycles.js';
export { assertNoSlotCycles } from './steps/apply/src/controller/validation/assert-no-slot-cycles.js';
export { assertNoUnresolvedSlotReferences } from './steps/apply/src/controller/validation/assert-no-unresolved-slot-references.js';
export { formatSlotCycleReport } from './steps/apply/src/controller/validation/format-slot-cycle-report.js';
export { formatUnresolvedSlotReferences } from './steps/apply/src/controller/validation/format-unresolved-slot-references.js';

// Apply — inline CDF mutation (final-review edits)
export {
  mutateCdfComponent,
  applyComponentPatch, // legacy-name alias
  type ComponentPatchOperation,
  type MutateCdfComponentRequest,
  type ApplyComponentPatchRequest, // legacy-name alias
} from './steps/apply/src/controller/mutate/mutate-cdf-component.js';
export {
  mutateDotPath,
  applyDotPath, // legacy-name alias
  type MutateDotPathRequest,
  type ApplyDotPathRequest, // legacy-name alias
} from './steps/apply/src/controller/mutate/mutate-dot-path.js';
export { warnOnUnknownPatchComponents } from './steps/apply/src/controller/mutate/warn-on-unknown-patch-components.js';

// Apply — preview output transforms
export { annotatePreview, type PreviewAnnotation } from './steps/apply/src/controller/preview/annotate-preview.js';
// Legacy name used by TUI call sites — same impl, positional-args signature
export { annotatePreview as applyPreviewAnnotations } from './steps/apply/src/helpers/annotate-preview.js';

// Apply — server error parsing
export { parseEdsiError, type ParsedEdsiError } from './steps/apply/src/controller/errors/parse-edsi-error.js';
export { formatEdsiError } from './steps/apply/src/controller/errors/format-edsi-error.js';
export { formatApiError, type ApiErrorLike } from './steps/apply/src/controller/errors/format-api-error.js';
export { stripLambdaLogPrefix } from './steps/apply/src/helpers/edsi-errors/strip-lambda-log-prefix.js';

// Apply — token file reading
export { readTokensFromPath } from './steps/apply/src/controller/tokens/read-tokens-from-path.js';

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

// Generation — component cache helpers (shared cache-key normalization + precedence)
export { normalizeComponentForCache } from './steps/generation/src/helpers/components/normalize-component-for-cache.js';
export { lookupComponentCache } from './steps/generation/src/helpers/components/lookup-component-cache.js';
export {
  resolveComponentCache,
  type ComponentCacheResolution,
} from './steps/generation/src/helpers/components/resolve-component-cache.js';

// Apply — shared pre-flight (read creds + validate CDF + build client)
export {
  resolveSharedInputs,
  ResolveSharedInputsFailure,
  type SharedInputs,
} from './steps/apply/src/controller/endpoint/resolve-shared-inputs.js';

// Generation — map-tokens (apply parsed map_token_prop calls to a session)
export { applyMapTokenPropCalls } from './steps/generation/src/controller/map-tokens/apply-map-token-prop-calls.js';
export type { ApplyMapTokenPropCallsResult } from './steps/generation/src/types/map-tokens.js';
export type { MapTokenPropCall, ParsedMapTokenPropToolCalls } from './agents/types/tool-calls.js';

// Generation — map-tokens orchestrator (full flow: resolve defaults → cache → agent → apply)
export { runMapTokens, MapTokensRunFailure } from './steps/generation/src/controller/map-tokens/run-map-tokens.js';
export type {
  MapTokensRunRequest,
  MapTokensRunResult,
  MapTokensRunError,
} from './steps/generation/src/types/map-tokens-run.js';

// Persistence — file collection + legacy SessionHandle (cache callbacks)
export { collectFiles, openSession, generateSessionId } from './persistence/src/index.js';
export type { OpenSessionOptions, SelectionDecision, SessionHandle } from './persistence/src/index.js';

// Persistence — DB infra + schema + migrations
export {
  openPipelineDb,
  getPipelineDbPath,
  runMigrationIfNeeded,
  resolveExtractSessionId,
} from './persistence/src/index.js';

// Persistence — config paths + settings
export {
  configRoot,
  configFilePath,
  runsFilePath,
  debugSessionsDir,
  oldConfigDir,
  readSettings,
  writeSettings,
  updateSettings,
} from './persistence/src/index.js';
export type { Settings } from './persistence/src/index.js';

// Persistence — credentials store (shared config.json)
export {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  experiencesCredentialsPath,
  DEFAULT_CONFIGURED_HOST,
} from './persistence/src/index.js';
export type { ExperiencesCredentials } from './persistence/src/index.js';

// Persistence — session + step state
export { getOrCreateSession, createStep, updateStep, findLatestSessionForCommand } from './persistence/src/index.js';
export type { CommandName, MatchHints } from './persistence/src/index.js';

// Persistence — raw component storage
export {
  storeRawComponents,
  loadRawComponents,
  loadComponentSourceRef,
  loadComponentSourceRefs,
  renameEmptySlots,
} from './persistence/src/index.js';
export type { RawComponentWithId } from './persistence/src/index.js';

// Persistence — CDF storage
export { storeCDFComponents, loadCDFComponents, loadScopeComponents } from './persistence/src/index.js';
export type { ScopeComponentRow } from './persistence/src/index.js';

// Persistence — review metadata (DB)
export {
  loadComponentReviewMetadata,
  loadComponentRationale,
  applyToolCalls,
  applyScopeDecisions,
  markCacheHumanEdited,
} from './persistence/src/index.js';
export type {
  ComponentReviewMetadata,
  ComponentRationale,
  ApplyToolCallsResult,
  ApplyToolCallsOptions,
} from './persistence/src/index.js';

// Persistence — resume seeds
export {
  seedCDFFromPriorSession,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
  backfillUnclassifiedProps,
} from './persistence/src/index.js';

// Persistence — cache (lookup/store/copy, keys)
export {
  lookupCache,
  lookupCacheByEntity,
  storeCache,
  storeCaches,
  storeExtractCache,
  lookupExtractCache,
  storeCompositionCache,
  lookupCompositionCache,
  storeSelectCache,
  lookupSelectCache,
  copyComponentFromCache,
  copyComponentsFromCache,
  copyTokensFromCache,
  copyMapTokensFromCache,
  computeMapTokensInputHash,
  computeComponentInputHash,
  computeTokenInputHash,
  hashContent,
} from './persistence/src/index.js';
export type {
  CacheEntityType,
  CacheEntry,
  SelectDecision,
  SelectCacheEntry,
  ExtractCacheEntry,
} from './persistence/src/index.js';

// Persistence — slot cycles + unresolved slot refs
export {
  storeSlotCycles,
  loadSlotCycles,
  clearSlotCycles,
  findUnknownSlotAllowedComponents,
  filterUnknownSlotAllowedComponents,
} from './persistence/src/index.js';
export type { StoredSlotCycle, UnknownSlotAllowedComponent } from './persistence/src/index.js';

// Persistence — scanned files tracking
export { storeScannedFiles, loadScannedFiles } from './persistence/src/index.js';

// Persistence — token writers
export {
  storeDtcgTokens,
  applyTokenToolCalls,
  replaceRawTokenNamePaths,
  replaceRawPropTokenPaths,
} from './persistence/src/index.js';

// Persistence — pure helpers
export {
  deriveComponentId,
  hashComponentShape,
  hashTokenContent,
  buildDtcgGroups,
  buildDtcgTokens,
} from './persistence/src/index.js';

// Shared
export type { CandidateFile } from './steps/shared/index.js';
