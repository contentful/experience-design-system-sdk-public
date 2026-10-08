// --- File collection (source-tree walker) ---
export { collectFiles } from './helpers/collect-files.js';

// --- Runs ledger (runs.json) ---
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
} from './runs/index.js';
export type {
  RunRecord,
  RunsFile,
  AppendInput,
  ListOptions,
  RunRecordV1,
  RunRecordV2,
  RunsFileV1,
  RunsFileV2,
  SourceFingerprint,
  SourceFileEntry,
  RawComponentsDb,
} from './runs/index.js';

// --- Review-session (per-session on-disk review state files) ---
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
  loadAcceptedNames,
  parsePrecomputedCachedNames,
} from './review-session/index.js';
export type {
  LoadReviewInputOptions,
  PreviewAnnotation,
  ReviewComponentStatus,
  ReviewComponentRecord,
  ReviewComponentDetail,
  ReviewComponentSummary,
  ReviewSessionSnapshot,
  ReviewSessionDetail,
  ReviewSessionSummary,
  ReviewEvent,
  ReviewSessionPaths,
} from './review-session/index.js';

// --- Session (SessionHandle + openSession for cache callbacks) ---
export { generateSessionId, openSession } from './session/index.js';
export type { OpenSessionOptions, SelectionDecision, SessionHandle, WriteResult } from './types/contract.js';

// --- DB infra + schema + migrations ---
export { openPipelineDb, getPipelineDbPath } from './session/db.js';
export { runMigrationIfNeeded } from './session/migration.js';
export {
  configRoot,
  configFilePath,
  runsFilePath,
  debugSessionsDir,
  oldConfigDir,
  readSettings,
  writeSettings,
  updateSettings,
} from './session/config-root.js';
export type { Settings } from './session/config-root.js';
export { resolveExtractSessionId } from './session/resolve-session-id.js';

// --- Credentials store (per-user config.json settings) ---
export {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  experiencesCredentialsPath,
  toApiHost,
  toConfiguredHost,
  DEFAULT_CONFIGURED_HOST,
} from './credentials/index.js';
export type { ExperiencesCredentials } from './credentials/index.js';

// --- Session + step state ---
export { getOrCreateSession, createStep, updateStep, findLatestSessionForCommand } from './session/db.js';
export type { CommandName, MatchHints } from './session/db.js';

// --- Raw component storage ---
export {
  storeRawComponents,
  loadRawComponents,
  loadComponentSourceRef,
  loadComponentSourceRefs,
  renameEmptySlots,
} from './session/db.js';
export type { RawComponentWithId } from './session/db.js';

// --- CDF component storage ---
export { storeCDFComponents, loadCDFComponents, loadScopeComponents } from './session/db.js';
export type { ScopeComponentRow } from './session/db.js';

// --- DTCG token storage (read side) ---
export { loadDTCGTokens } from './session/db.js';

// --- Review metadata (DB) ---
export {
  loadComponentReviewMetadata,
  loadComponentRationale,
  applyToolCalls,
  applyScopeDecisions,
  markCacheHumanEdited,
} from './session/db.js';
export type {
  ComponentReviewMetadata,
  ComponentRationale,
  ApplyToolCallsResult,
  ApplyToolCallsOptions,
} from './session/db.js';

// --- Resume seeds ---
export {
  seedCDFFromPriorSession,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
  backfillUnclassifiedProps,
} from './session/db.js';

// --- Cache (lookup/store/copy across sessions, keys) ---
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
} from './session/db.js';
export type { CacheEntityType, CacheEntry, SelectDecision, SelectCacheEntry, ExtractCacheEntry } from './session/db.js';

// --- Hashers ---
export { hashContent, hashFile, hashPromptForSkill } from './session/cache-keys.js';

// --- Slot cycles + slot refs validation ---
export {
  storeSlotCycles,
  loadSlotCycles,
  clearSlotCycles,
  findUnknownSlotAllowedComponents,
  filterUnknownSlotAllowedComponents,
} from './session/db.js';
export type { StoredSlotCycle, UnknownSlotAllowedComponent } from './session/db.js';

// --- Scanned files tracking ---
export { storeScannedFiles, loadScannedFiles } from './session/db.js';

// --- Token writers (services wrapping repositories) ---
export { storeDtcgTokens } from './session/services/tokens/store-dtcg-tokens.js';
export { applyTokenToolCalls } from './session/services/tokens/apply-tool-calls.js';
export { replaceRawTokenNamePaths } from './session/services/tokens/replace-raw-token-name-paths.js';
export { replaceRawPropTokenPaths } from './session/services/tokens/replace-raw-prop-token-paths.js';

// --- Pure helpers consumed by writers ---
export { deriveComponentId } from './session/core/components/derive-component-id.js';
export { hashComponentShape } from './session/core/components/hash-component-shape.js';
export { hashTokenContent } from './session/core/tokens/hash-token-content.js';
export { buildDtcgGroups } from './session/core/tokens/build-dtcg-groups.js';
export { buildDtcgTokens } from './session/core/tokens/build-dtcg-tokens.js';
