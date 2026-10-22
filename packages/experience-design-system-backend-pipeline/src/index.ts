export {
  exportCdfDocument,
  ExportCdfDocumentFailure,
  printComponents,
  PrintComponentsFailure,
} from './steps/generation/src/controller/export/export-cdf-document.js';
export {
  exportDtcgTree,
  ExportDtcgTreeFailure,
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
  PrintComponentsRequest,
  PrintComponentsResult,
  PrintComponentsError,
  PrintTokensRequest,
  PrintTokensResult,
  PrintTokensError,
} from './steps/generation/src/controller/export/types-export.js';
export { validateCDFFile } from './steps/shared/cdf/validators/validate-cdf-file.js';
export { validateDTCGTokenFile } from './steps/shared/dtcg/validators/validate-dtcg-token-file.js';
export { formatDiagnostics } from './steps/shared/cdf/validators/format-diagnostics.js';
export { readJsonFile } from './steps/shared/cdf/validators/read-json-file.js';
export type { ValidationResult, ValidationDiagnostic } from './steps/shared/cdf/validators/types-validation.js';
export { rebuildDTCGTree } from './steps/shared/dtcg/helpers/rebuild-dtcg-tree.js';
export { extractComponents } from './steps/extraction/src/controller/extract-components-endpoint.js';
export type {
  ExtractComponentsRequest,
  ExtractComponentsResponse,
  ExtractionEndpointProgress,
} from './steps/extraction/src/types/contract.js';
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
export { applyCompositionEdges, applyMapping } from './steps/composition/src/helpers/edges/apply-mapping.js';
export { resolveMapping } from './steps/composition/src/helpers/edges/resolve-mapping.js';
export { collectSourceCallSiteEvidence } from './steps/composition/src/helpers/edges/source-call-site-evidence.js';
export type {
  SourceCallSiteEvidence,
  SourceCallSiteRejection,
  SourceCallSiteEvidenceResult,
  SourceCallerInput,
} from './steps/composition/src/helpers/edges/source-call-site-evidence.js';
export { loadPrompt } from './steps/composition/src/helpers/prompt/prompt-loader.js';
export { buildCompositionInputHash } from './steps/composition/src/helpers/candidates/composition-cache-key.js';
export { resolveCompositionSources } from './steps/composition/src/helpers/edges/resolve-composition-sources.js';
export type {
  CompositionCliOptions,
  ResolvedCompositionSources,
} from './steps/composition/src/helpers/edges/resolve-composition-sources.js';
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
  ComponentGraphInput as SlotGraphInput,
  SlotEdge,
  SlotCycle,
  CyclePathSegment,
  CycleAwareRejectResult,
  NodeStatus,
  RenderStatus,
  Closure,
  ClosureNode,
} from './steps/composition/src/types/graph.js';
export { selectComponents } from './steps/selection/src/controller/select-components-endpoint.js';
export type {
  SelectComponentsEndpointRequest,
  SelectComponentsEndpointResponse,
  ComponentSelection,
  SelectionServiceResult,
} from './steps/selection/src/types/contract.js';
export { loadAndValidateForReview } from './steps/selection/src/controller/review/load-and-validate-for-review.js';
export { mergePreviewValidationErrorsIntoReviewSession } from './steps/selection/src/controller/review/merge-preview-validation-errors-into-review-session.js';
export { mergePreviewValidationErrorsIntoReviewSession as patchReviewStateWithValidationErrors } from './steps/selection/src/controller/review/merge-preview-validation-errors-into-review-session.js';
export { rejectComponentsByName } from './steps/selection/src/controller/review/reject-components-by-name.js';
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
export { generateCdfComponents } from './steps/generation/src/controller/generate-cdf-components-endpoint.js';
export type {
  GenerateCdfComponentsRequest,
  GenerateCdfComponentsResponse,
  CdfGenerationFailure,
} from './steps/generation/src/types/contract.js';
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
export { ApiClient as ImportApiClient } from './steps/apply/src/helpers/api-client/api-client.js';
export type { ApiClientOptions, RetryConfig } from './steps/apply/src/types/contract.js';
export type { PreviewValidationError } from './steps/apply/src/types/contract.js';
export { parsePreviewValidationErrors } from './steps/apply/src/helpers/parse-preview-errors.js';
export { toApiHost, toConfiguredHost } from './steps/apply/src/helpers/host-utils.js';
export { detectSlotCycles } from './steps/apply/src/controller/validation/detect-slot-cycles.js';
export { assertNoSlotCycles } from './steps/apply/src/controller/validation/assert-no-slot-cycles.js';
export { assertNoUnresolvedSlotReferences } from './steps/apply/src/controller/validation/assert-no-unresolved-slot-references.js';
export { formatSlotCycleReport } from './steps/apply/src/controller/validation/format-slot-cycle-report.js';
export { formatUnresolvedSlotReferences } from './steps/apply/src/controller/validation/format-unresolved-slot-references.js';
export {
  mutateCdfComponent,
  applyComponentPatch,
  type ComponentPatchOperation,
  type MutateCdfComponentRequest,
  type ApplyComponentPatchRequest,
} from './steps/apply/src/controller/mutate/mutate-cdf-component.js';
export {
  mutateDotPath,
  applyDotPath,
  type MutateDotPathRequest,
  type ApplyDotPathRequest,
} from './steps/apply/src/controller/mutate/mutate-dot-path.js';
export { warnOnUnknownPatchComponents } from './steps/apply/src/controller/mutate/warn-on-unknown-patch-components.js';
export { annotatePreview, type PreviewAnnotation } from './steps/apply/src/controller/preview/annotate-preview.js';
export { annotatePreview as applyPreviewAnnotations } from './steps/apply/src/helpers/annotate-preview.js';
export { parseEdsiError, type ParsedEdsiError } from './steps/apply/src/controller/errors/parse-edsi-error.js';
export { formatEdsiError } from './steps/apply/src/controller/errors/format-edsi-error.js';
export { formatApiError, type ApiErrorLike } from './steps/apply/src/controller/errors/format-api-error.js';
export { stripLambdaLogPrefix } from './steps/apply/src/helpers/edsi-errors/strip-lambda-log-prefix.js';
export { readTokensFromPath } from './steps/apply/src/controller/tokens/read-tokens-from-path.js';
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
export { AGENT_NAMES, type AgentName } from './agents/types/agent-name.js';
export { DEFAULT_AGENT_NAME, DEFAULT_MODELS } from './agents/constants/models.js';
export { AGENT_BINARIES } from './agents/constants/binaries.js';
export { isAgentName } from './agents/helpers/resolution/is-agent-name.js';
export { agentSupportsBedrock } from './agents/helpers/bedrock/agent-supports-bedrock.js';
export { checkAgentAuth } from './agents/services/check-agent-auth.js';
export type { AgentAuthStatus } from './agents/types/agent-run.js';
export { buildPrompt } from './agents/prompts/build-prompt.js';
export { buildCompilerEvidenceInline } from './agents/prompts/helpers/build-compiler-evidence-inline.js';
export type { CompilerEvidenceReadiness } from './agents/prompts/helpers/build-compiler-evidence-inline.js';
export { buildSelectionEvidenceInline } from './agents/prompts/helpers/build-selection-evidence-inline.js';
export type {
  ComponentSourceRef,
  CapturedSourceRefMetadata,
  DebateRole,
  GeneratedCdf,
  Mode,
  PromptOptions,
  Skill,
} from './agents/types/prompts.js';
export { stripPropProvenance } from './agents/prompts/helpers/strip-prop-provenance.js';
export { bucketComponentsProps } from './steps/extraction/index.js';
export { resolveSkillPath } from './agents/prompts/resolve-skill-path.js';
export { createLocalCliAgentInvoker } from './agents/invoker/create-local-cli-agent-invoker.js';
export { parseSelectToolCalls } from './agents/parsers/parse-select-tool-calls.js';
export { parseTokenToolCalls } from './agents/parsers/parse-token-tool-calls.js';
export { buildContentfulManagementClient } from './steps/generation/src/controller/client/build-contentful-management-client.js';
export { fetchAndPersistExistingContentfulEntities } from './steps/generation/src/controller/existing-entities/fetch-and-persist.js';
export type {
  FetchAndPersistExistingEntitiesRequest,
  FetchAndPersistResult,
  FetchAndPersistSuccess,
  FetchAndPersistFailure,
} from './steps/generation/src/controller/existing-entities/fetch-and-persist.js';
export { readExistingContentfulEntitiesFromSession } from './steps/generation/src/controller/existing-entities/read-from-session.js';
export { fetchExistingContentfulEntitiesFromContentful } from './steps/generation/src/helpers/existing-entities/fetch-from-contentful.js';
export { summarizeForSelect } from './steps/generation/src/controller/existing-entities/summarize-for-select.js';
export {
  summarizeForGenerate,
  summarizeForGenerateAgent,
} from './steps/generation/src/controller/existing-entities/summarize-for-generate.js';
export { summarizeForMapTokens } from './steps/generation/src/controller/existing-entities/summarize-for-map-tokens.js';
export type { ExistingContentfulEntities } from './steps/generation/src/types/existing-entities.js';
export {
  bindCatalogueCaptureToSession,
  loadBoundSessionPrerequisiteSnapshot,
  setSessionTokenReferenceMapping,
  createSessionPrerequisiteSaveReceipt,
  verifyLocalSavedPrerequisiteReceipt,
} from './persistence/src/session/repositories/import-prerequisites.js';
export type {
  SessionPrerequisiteSaveReceipt,
  SessionPrerequisiteSnapshot,
  PrerequisiteTarget,
} from './persistence/src/session/repositories/import-prerequisites.js';
export type {
  SelectAgentSummary,
  GenerateAgentSummary,
  MapTokensSummary,
} from './steps/generation/src/types/summaries.js';
export { resolveTokenDefaults } from './steps/generation/src/controller/token-defaults/resolve-token-defaults.js';
export type {
  RawDesignTokenDefault,
  DTCGTokenLeaf,
  ResolveTokenDefaultsResult,
} from './steps/generation/src/types/token-defaults.js';
export { findNearlyMatchingComponent } from './steps/generation/src/helpers/existing-entities/find-nearly-matching-component.js';
export { normalizeComponentForCache } from './steps/generation/src/helpers/components/normalize-component-for-cache.js';
export { lookupComponentCache } from './steps/generation/src/helpers/components/lookup-component-cache.js';
export {
  resolveComponentCache,
  type ComponentCacheResolution,
} from './steps/generation/src/helpers/components/resolve-component-cache.js';
export {
  resolveSharedInputs,
  ResolveSharedInputsFailure,
  type SharedInputs,
} from './steps/apply/src/controller/endpoint/resolve-shared-inputs.js';
export { applyMapTokenPropCalls } from './steps/generation/src/controller/map-tokens/apply-map-token-prop-calls.js';
export type { ApplyMapTokenPropCallsResult } from './steps/generation/src/types/map-tokens.js';
export type { MapTokenPropCall, ParsedMapTokenPropToolCalls } from './agents/types/tool-calls.js';
export { runMapTokens, MapTokensRunFailure } from './steps/generation/src/controller/map-tokens/run-map-tokens.js';
export type {
  MapTokensRunRequest,
  MapTokensRunResult,
  MapTokensRunError,
} from './steps/generation/src/types/map-tokens-run.js';
export { collectFiles, openSession, generateSessionId } from './persistence/src/index.js';
export type { OpenSessionOptions, SelectionDecision, SessionHandle } from './persistence/src/index.js';
export {
  openPipelineDb,
  getPipelineDbPath,
  runMigrationIfNeeded,
  resolveExtractSessionId,
} from './persistence/src/index.js';
export { completeExtractionWithSourceEvidence, loadCompletedSourceEvidence } from './persistence/src/index.js';
export type { CompletedSourceEvidence, SessionSourceEnvelope, SourceEvidenceHandle } from './persistence/src/index.js';
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
export {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  experiencesCredentialsPath,
  DEFAULT_CONFIGURED_HOST,
} from './persistence/src/index.js';
export type { ExperiencesCredentials } from './persistence/src/index.js';
export { getOrCreateSession, createStep, updateStep, findLatestSessionForCommand } from './persistence/src/index.js';
export type { CommandName, MatchHints } from './persistence/src/index.js';
export {
  storeRawComponents,
  loadRawComponents,
  loadComponentSourceRef,
  loadComponentSourceRefs,
  loadSavedComponentSourceRef,
  loadSavedSharedSource,
  loadExtractionSourceDiagnostics,
  renameEmptySlots,
} from './persistence/src/index.js';
export type { RawComponentWithId } from './persistence/src/index.js';
export {
  storeCDFComponents,
  loadCDFComponents,
  loadSelectedCDFComponents,
  evaluateComponentReadiness,
  loadScopeComponents,
  loadScopeDecisions,
} from './persistence/src/index.js';
export type { ScopeComponentRow, ScopeDecisions, ScopeDecisionProvenance } from './persistence/src/index.js';
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
export type { ExtractionSourceDiagnosticsRead } from './persistence/src/index.js';
export {
  seedCDFFromPriorSession,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
  backfillUnclassifiedProps,
} from './persistence/src/index.js';
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
  hashFile,
  hashPromptForSkill,
  getCliCacheVersion,
  loadDTCGTokens,
  loadRawTokenNamePathRows,
} from './persistence/src/index.js';
export type {
  CacheEntityType,
  CacheEntry,
  SelectDecision,
  SelectCacheEntry,
  ExtractCacheEntry,
} from './persistence/src/index.js';
export {
  storeSlotCycles,
  loadSlotCycles,
  clearSlotCycles,
  findUnknownSlotAllowedComponents,
  filterUnknownSlotAllowedComponents,
} from './persistence/src/index.js';
export type { StoredSlotCycle, UnknownSlotAllowedComponent } from './persistence/src/index.js';
export { storeScannedFiles, loadScannedFiles } from './persistence/src/index.js';
export {
  storeDtcgTokens,
  applyTokenToolCalls,
  replaceRawTokenNamePaths,
  replaceRawPropTokenPaths,
} from './persistence/src/index.js';
export {
  deriveComponentId,
  hashComponentShape,
  hashTokenContent,
  buildDtcgGroups,
  buildDtcgTokens,
  escapeForRegExp,
  excerptAroundNames,
} from './persistence/src/index.js';
export {
  appendRun,
  listRuns,
  getRun,
  updateRun,
  buildSourceFingerprint,
  detectSaveConflict,
  buildTimestampedSubdir,
  sha256Hex,
  generateUlid,
  RUNS_FILE_VERSION,
  READABLE_VERSIONS,
} from './persistence/src/index.js';
export type {
  RunRecord,
  RunsFile,
  AppendInput,
  ListOptions,
  SourceFingerprint,
  SourceFileEntry,
  RawComponentsDb,
} from './persistence/src/index.js';
export { loadAcceptedNames, parsePrecomputedCachedNames } from './persistence/src/index.js';
export type { CandidateFile } from './steps/shared/index.js';
export { storeDtcgTokens as storeDTCGTokens } from './persistence/src/index.js';
export type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ExtractionValidationIssue,
  ExtractionValidationIssueCode,
  ComponentExtractionResult,
  ExtractionExclusion,
  ExtractorProgress,
} from './steps/extraction/src/types/component.js';
export { runExtractAndComposeSession } from './orchestrators/run-extract-and-compose-session/run-extract-and-compose-session.js';
export type {
  RunExtractAndComposeSessionRequest,
  RunExtractAndComposeSessionResponse,
  ExtractAndComposeProgress,
} from './orchestrators/run-extract-and-compose-session/run-extract-and-compose-session.js';
export { runGenerateTokensSession } from './orchestrators/run-generate-tokens-session/run-generate-tokens-session.js';
export type {
  RunGenerateTokensSessionRequest,
  RunGenerateTokensSessionResponse,
  GenerateTokensProgress,
} from './orchestrators/run-generate-tokens-session/run-generate-tokens-session.js';
export {
  runGenerateComponentsSession,
  checkGenerateComponentsCache,
} from './orchestrators/run-generate-components-session/run-generate-components-session.js';
export type {
  RunGenerateComponentsSessionRequest,
  RunGenerateComponentsSessionResponse,
  GenerateComponentsProgress,
  GeneratedComponentResult,
  CheckGenerateComponentsCacheRequest,
  CheckGenerateComponentsCacheResponse,
} from './orchestrators/run-generate-components-session/run-generate-components-session.js';

// Analytics (telemetry for `experiences import` / legacy wrapper commands).
// `exitWithAnalytics` stays in cli-legacy because it calls `process.exit`.
export {
  ANALYTICS_SESSION_ENV,
  IMPORT_PIPELINE_ENV,
  analyticsEnabled,
  bindAnalyticsSessionId,
  cliVersion,
  completeActiveCommand,
  emitSessionStarted,
  enrichCommandResult,
  failActiveCommand,
  flushAnalytics,
  isPipelineAnalyticsChild,
  noteCommandStart,
  recordApplyOutcome,
  recordContentfulContext,
  setCliVersion,
  setCommandContext,
  setPersistedAnalyticsDisabled,
} from './analytics/index.js';
export type {
  CommandCompletion,
  CommandContext,
  CommandFailure,
  DsiCliCommand,
  EntryCommand,
  OsName,
  AnalyticsWriteResult,
} from './analytics/index.js';

export * from './steps/exploration/src/index.js';

export {
  loadExplorationRun,
  loadExplorationReports,
  loadExplorationAttempts,
  loadAcceptedSlotDecisions,
  loadExplorationRecord,
} from './persistence/src/session/repositories/exploration/records.js';
export {
  projectAcceptedSlots,
  projectAcceptedRawSlots,
} from './steps/exploration/src/services/project-accepted-slots.js';

export * from './orchestrators/run-exploration-session/index.js';

export type { CompletedSharedSourceEvidence } from './persistence/src/session/repositories/db.js';

export { buildSharedSource, projectSharedSource, renderSharedSource } from './source-evidence/shared-source.js';
export type {
  SharedSource,
  SharedSourceFile,
  SharedSourceReference,
  SharedSourceRange,
  SharedSourceCallerCoverage,
} from '@contentful/experience-design-system-types';

export { loadPropertyDecisions } from './persistence/src/session/repositories/db.js';

export {
  loadExistingExplorationContext,
  type ExistingExplorationContext,
} from './orchestrators/run-exploration-session/helpers/load-existing-context.js';
export { discoverSourceEvidence } from './steps/extraction/index.js';
export type { SourceEvidenceInventory } from './steps/extraction/index.js';

export {
  analyzePropertyRepresentations,
  analyzePropertyRepresentationCandidates,
  loadRepresentationPlans,
  selectRepresentationPlan,
} from './persistence/src/session/repositories/representation-plans.js';
