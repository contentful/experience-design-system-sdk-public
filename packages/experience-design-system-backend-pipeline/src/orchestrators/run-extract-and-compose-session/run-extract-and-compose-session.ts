import { mkdir } from 'node:fs/promises';
import { relative } from 'node:path';
import {
  captureSourceEvidence,
  evaluateExtractionQuality,
  preClassifyComponent,
} from '@contentful/experience-design-system-extraction';
import { resolveCompositionSources } from '../../steps/composition/src/helpers/edges/resolve-composition-sources.js';
import {
  createStep,
  completeExtractionWithSourceEvidence,
  getCliCacheVersion,
  getOrCreateSession,
  openPipelineDb,
  storeRawComponents,
} from '../../persistence/src/session/repositories/db.js';
import { emitPreClassificationExclusions } from './helpers/emit-pre-classification-exclusions.js';
import { extractComponentsWithCache } from './helpers/extract-components-with-cache.js';
import { persistExtractCache } from './helpers/persist-extract-cache.js';
import { calculateSlotCycles } from './helpers/persist-slot-cycles.js';
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
import { throwIfAborted } from '../../helpers/abort.js';
import { deriveComponentId } from '../../persistence/src/session/helpers/components/derive-component-id.js';

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
  throwIfAborted(request.signal);
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
    throwIfAborted(request.signal);

    // Fail-fast on bad prompt-override syntax before any DB writes or agent calls.
    const compositionPrompt = await resolveCompositionPrompt(promptOverrides);
    throwIfAborted(request.signal);

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
    throwIfAborted(request.signal);

    throwIfAborted(request.signal);
    await mkdir(outDir, { recursive: true });
    throwIfAborted(request.signal);

    // Notify the caller of the session while extraction completion is still pending.
    const { sessionId } = getOrCreateSession(db, undefined, undefined, {
      command: 'analyze extract',
      inputPath: projectPath,
      outDir,
    });
    throwIfAborted(request.signal);
    await onSessionCreated?.(sessionId);
    throwIfAborted(request.signal);

    await bindAnalyticsSessionId(sessionId);
    throwIfAborted(request.signal);
    if (!isPipelineAnalyticsChild()) await emitSessionStarted('import');
    throwIfAborted(request.signal);

    throwIfAborted(request.signal);
    const stepId = createStep(db, sessionId, 'analyze extract', { project: projectPath });

    if (cacheHits === 0 && !noCache) {
      await persistExtractCache(db, sourceFiles, extraction.components, cacheVersion);
      throwIfAborted(request.signal);
    }

    emitPreClassificationExclusions(extraction, onExclusion);

    const classifiedComponents = extraction.components.map(preClassifyComponent);
    const { components: initialValidatedComponents, warnings: filterWarnings } =
      await evaluateExtractionQuality(classifiedComponents);
    throwIfAborted(request.signal);

    // Persist initial rows for composition; downstream selection waits for final completion.
    storeRawComponents(db, sessionId, initialValidatedComponents);
    throwIfAborted(request.signal);

    const sourceCapture = await captureSourceEvidence({
      projectRoot: projectPath,
      filePaths: sourceFiles,
      components: initialValidatedComponents.map((component) => ({
        componentId: deriveComponentId(component.name, component.source),
        name: component.name,
        sourcePath: component.sourcePath ?? component.source,
      })),
      signal: request.signal,
    });
    throwIfAborted(request.signal);

    const sources = resolveCompositionSources({ noCache, compositionRefresh });
    const composition = await resolveComposition({
      db,
      components: initialValidatedComponents,
      sourceFiles,
      sourceCapture,
      cacheVersion,
      noCache,
      compositionRefresh,
      forceAgent: sources.forceAgent,
      compositionPrompt,
      agent,
      bedrock,
      signal: request.signal,
      onProgress,
      onDebugEvent,
    });
    throwIfAborted(request.signal);

    // Final rows, source evidence and completion identity publish together.
    throwIfAborted(request.signal);
    const sourceEvidenceHandle = await retryDatabaseWrite(
      () =>
        completeExtractionWithSourceEvidence(db, {
          sessionId,
          stepId,
          components: composition.components,
          cycles: calculateSlotCycles(composition.components),
          scannedFiles: sourceFiles.map((f) => relative(projectPath, f)),
          capture: sourceCapture,
          observations: {
            accepted: composition.sourceCallSiteEvidence,
            rejected: composition.sourceCallSiteRejections,
          },
        }),
      8,
      request.signal,
    );
    throwIfAborted(request.signal);

    enrichCommandResult({ extracted_component_count: composition.components.length });

    return {
      sessionId,
      compositionPhase: composition.phase,
      components: composition.components,
      warnings: [...extraction.warnings, ...filterWarnings],
      conflicts: composition.conflicts,
      compositionWarnings: composition.warnings,
      scannedFileCount: sourceFiles.length,
      sourceCallSiteEvidence: composition.sourceCallSiteEvidence,
      sourceCallSiteRejections: composition.sourceCallSiteRejections,
      sourceEvidenceHandle,
    };
  } finally {
    db.close();
  }
}
