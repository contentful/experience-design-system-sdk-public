import { mkdir } from 'node:fs/promises';
import { relative } from 'node:path';
import { evaluateExtractionQuality, preClassifyComponent } from '../../steps/extraction/index.js';
import {
  createStep,
  getPipelineDbPath,
  getCliCacheVersion,
  getOrCreateSession,
  openPipelineDb,
} from '../../persistence/src/session/repositories/db.js';
import { emitPreClassificationExclusions } from './helpers/emit-pre-classification-exclusions.js';
import { extractComponentsWithCache } from './helpers/extract-components-with-cache.js';
import { persistExtractCache } from './helpers/persist-extract-cache.js';
import { calculateSlotCycles } from './helpers/persist-slot-cycles.js';
import { resolveComposition } from './helpers/resolve-composition.js';
import { parsePromptOverrides } from '../../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import {
  bindAnalyticsSessionId,
  emitSessionStarted,
  enrichCommandResult,
  isPipelineAnalyticsChild,
} from '../../analytics/index.js';
import type { RunExtractAndComposeSessionRequest, RunExtractAndComposeSessionResponse } from './types.js';
import { throwIfAborted } from '../../helpers/abort.js';
import { deriveComponentId } from '../../persistence/src/session/helpers/components/derive-component-id.js';
import { runSourceAnalysis } from '../../source-analysis/run.js';

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
 *   - raw_components (initial worker save, then atomic completed-source publication preserving review state)
 *   - extract_cache rows (one per source file, when the extract-cache miss
 *     path was taken)
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
    promptOverrides,
    noCache,
    resolveUnreachable = 'auto',
    onProgress,
    onSessionCreated,
    onDebugEvent,
    onExclusion,
  } = request;

  const db = openPipelineDb();
  try {
    const cacheVersion = await getCliCacheVersion();
    throwIfAborted(request.signal);

    // Validate shared override syntax without resolving the retired composition prompt.
    const { errors } = parsePromptOverrides(promptOverrides);
    if (errors.length > 0) throw new Error(`Prompt override error(s): ${errors.join('; ')}`);
    throwIfAborted(request.signal);

    const { extraction, cacheHits } = await extractComponentsWithCache({
      signal: request.signal,
      db,
      sourceFiles,
      evidenceFilePaths: request.evidenceFilePaths ?? request.sourceInventory?.files.map((file) => file.canonicalPath),
      projectPath,
      cacheVersion,
      noCache: true,
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
    onProgress?.({ kind: 'source', phase: 'validating', activity: 'Checking extracted component definitions…' });
    const { components: initialValidatedComponents, warnings: filterWarnings } =
      await evaluateExtractionQuality(classifiedComponents);
    throwIfAborted(request.signal);

    await runSourceAnalysis(
      'storeExtraction',
      {
        dbPath: getPipelineDbPath(),
        sessionId,
        components: initialValidatedComponents,
        extractionDiagnostics: extraction.extractionDiagnostics,
      },
      { signal: request.signal },
    );
    throwIfAborted(request.signal);

    onProgress?.({
      kind: 'source',
      phase: 'capturing',
      activity: 'Capturing source files, dependencies and compiler evidence…',
    });
    const sourceCapture = await runSourceAnalysis(
      'capture',
      {
        projectRoot: projectPath,
        filePaths: sourceFiles,
        evidenceFilePaths: request.evidenceFilePaths,
        inventory: extraction.sourceInventory,
        compilerSources: extraction.compilerSources,
        components: initialValidatedComponents.map((component) => ({
          componentId: deriveComponentId(component.name, component.source),
          name: component.name,
          sourcePath: component.sourcePath ?? component.source,
        })),
      },
      { signal: request.signal },
    );
    throwIfAborted(request.signal);

    onProgress?.({ kind: 'source', phase: 'captured', activity: 'Waiting for relationship evidence before saving…' });
    const composition = await resolveComposition({
      components: initialValidatedComponents,
      sourceFiles,
      sourceCapture,
      signal: request.signal,
      onProgress,
    });
    throwIfAborted(request.signal);

    // Final rows, source evidence and completion identity publish together.
    throwIfAborted(request.signal);
    onProgress?.({
      kind: 'source',
      phase: 'publishing',
      activity: 'Saving source evidence and component relationships…',
    });
    const sourceEvidenceHandle = await runSourceAnalysis(
      'publishExtraction',
      {
        dbPath: getPipelineDbPath(),
        extraction: {
          sessionId,
          stepId,
          components: composition.components,
          cycles: calculateSlotCycles(composition.components),
          scannedFiles: sourceFiles.map((f) => relative(projectPath, f)),
          capture: sourceCapture,
          observations: {
            accepted: composition.sourceCallSiteEvidence,
            rejected: composition.sourceCallSiteRejections,
            ...(composition.sourceCallSiteCoverage ? { callerCoverage: composition.sourceCallSiteCoverage } : {}),
          },
          extractionDiagnostics: extraction.extractionDiagnostics,
        },
      },
      { signal: request.signal },
    );
    throwIfAborted(request.signal);

    enrichCommandResult({ extracted_component_count: composition.components.length });

    onProgress?.({ kind: 'source', phase: 'complete', activity: 'Source evidence ready for exploration' });
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
      sourceCallSiteCoverage: composition.sourceCallSiteCoverage,
      sourceEvidenceHandle,
    };
  } finally {
    db.close();
  }
}
