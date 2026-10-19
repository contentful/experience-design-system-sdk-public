import { mkdir } from 'node:fs/promises';
import { relative } from 'node:path';
import { evaluateExtractionQuality } from '../../steps/extraction/src/helpers/quality/evaluate-extraction-quality.js';
import { preClassifyComponent } from '../../steps/extraction/src/helpers/pre-classify.js';
import { resolveCompositionSources } from '../../steps/composition/src/helpers/edges/resolve-composition-sources.js';
import {
  createStep,
  getCliCacheVersion,
  getOrCreateSession,
  openPipelineDb,
  storeRawComponents,
  storeScannedFiles,
  updateStep,
} from '../../persistence/src/session/repositories/db.js';
import { emitPreClassificationExclusions } from './helpers/emit-pre-classification-exclusions.js';
import { extractComponentsWithCache } from './helpers/extract-components-with-cache.js';
import { persistExtractCache } from './helpers/persist-extract-cache.js';
import { persistSlotCycles } from './helpers/persist-slot-cycles.js';
import { resolveComposition } from './helpers/resolve-composition.js';
import { resolveCompositionPrompt } from './helpers/resolve-composition-prompt.js';
import { retryDatabaseWrite } from './helpers/retry-database-write.js';
import {
  bindAnalyticsSessionId,
  emitSessionStarted,
  enrichCommandResult,
  isPipelineAnalyticsChild,
} from '../../analytics/index.js';
import type { RunExtractAndComposeSessionRequest, RunExtractAndComposeSessionResponse } from './types.js';

export type {
  ExtractAndComposeProgress,
  RunExtractAndComposeSessionRequest,
  RunExtractAndComposeSessionResponse,
} from './types.js';

/**
 * Runs extraction + composition in-process against a pipeline session.
 *
 * Does, in order, everything the legacy `__extract` command does between
 * `openPipelineDb()` and the final summary emit — see
 * `cli-legacy/src/analyze/extract-command.ts:303-563` for the historical home.
 *
 * Writes to the session DB:
 *   - sessions row (via `getOrCreateSession`)
 *   - steps row (via `createStep` / `updateStep`)
 *   - raw_components (two writes: before composition, then after with
 *     `preserveStatus: true`)
 *   - extract_cache rows (one per source file, when the extract-cache miss
 *     path was taken)
 *   - composition_cache row (one, keyed on agent + prompt files)
 *   - slot_cycles rows
 *   - scanned_files rows
 *
 * The caller (either legacy CLI or v2 TUI) owns:
 *   - Scanning the project tree (`collectFiles`) and emitting scan progress
 *   - Analytics session binding / event emission
 *     (TODO: lifted into backend-pipeline in a follow-up PR)
 *   - Final summary / exit code
 */
export async function runExtractAndComposeSession(
  request: RunExtractAndComposeSessionRequest,
): Promise<RunExtractAndComposeSessionResponse> {
  const {
    projectPath,
    outDir,
    filePaths: sourceFiles,
    agent,
    promptOverrides,
    noCache,
    resolveUnreachable = 'auto',
    compositionRefresh = false,
    bedrock = false,
    onProgress,
    onSessionCreated,
    onDebugEvent,
    onExclusion,
  } = request;

  const db = openPipelineDb();
  try {
    const cacheVersion = await getCliCacheVersion();

    // Fail-fast on bad prompt-override syntax before any DB writes or agent calls.
    const compositionPrompt = await resolveCompositionPrompt(promptOverrides);

    const { extraction, cacheHits } = await extractComponentsWithCache({
      db,
      sourceFiles,
      projectPath,
      cacheVersion,
      noCache,
      resolveUnreachable,
      onProgress,
      onDebugEvent,
    });

    await mkdir(outDir, { recursive: true });

    // Mint the session and tell the caller — selection lane can start now.
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: projectPath,
      outDir,
    });
    await onSessionCreated?.(sessionId);

    await bindAnalyticsSessionId(sessionId);
    if (!isPipelineAnalyticsChild()) await emitSessionStarted('import');

    const stepId = createStep(db, sessionId, 'analyze extract', { project: projectPath });

    if (cacheHits === 0 && !noCache) {
      await persistExtractCache(db, sourceFiles, extraction.components, cacheVersion);
    }

    emitPreClassificationExclusions(extraction, onExclusion);

    const classifiedComponents = extraction.components.map(preClassifyComponent);
    const { components: initialValidatedComponents, warnings: filterWarnings } =
      await evaluateExtractionQuality(classifiedComponents);

    // First raw-components write — before composition so downstream stages can
    // start working while the (potentially agent-backed) mapper continues.
    storeRawComponents(db, sessionId, initialValidatedComponents);

    const sources = resolveCompositionSources({ noCache, compositionRefresh });
    const composition = await resolveComposition({
      db,
      components: initialValidatedComponents,
      sourceFiles,
      cacheVersion,
      noCache,
      compositionRefresh,
      forceAgent: sources.forceAgent,
      compositionPrompt,
      agent,
      bedrock,
      onProgress,
      onDebugEvent,
    });

    // Final writes — raw components (preserving selection decisions), slot
    // cycles, scanned files, step completion.
    await retryDatabaseWrite(() => storeRawComponents(db, sessionId, composition.components, { preserveStatus: true }));
    await persistSlotCycles(db, sessionId, composition.components);
    storeScannedFiles(
      db,
      sessionId,
      sourceFiles.map((f) => relative(projectPath, f)),
    );
    await retryDatabaseWrite(() => updateStep(db, stepId, 'complete', { sessionId }));

    enrichCommandResult({ extracted_component_count: composition.components.length });

    return {
      sessionId,
      compositionPhase: composition.phase,
      components: composition.components,
      warnings: [...extraction.warnings, ...filterWarnings],
      conflicts: composition.conflicts,
      compositionWarnings: composition.warnings,
      scannedFileCount: sourceFiles.length,
    };
  } finally {
    db.close();
  }
}
