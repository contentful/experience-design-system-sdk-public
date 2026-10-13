import { mkdir } from 'node:fs/promises';
import { relative } from 'node:path';
import { evaluateExtractionQuality, preClassifyComponent } from '@contentful/experience-design-system-extraction';
import { resolveMapping } from '../../steps/composition/src/helpers/edges/resolve-mapping.js';
import { resolveCompositionSources } from '../../steps/composition/src/helpers/edges/resolve-composition-sources.js';
import {
  selectCandidateFiles,
  capCandidatesToPromptBudget,
} from '../../steps/composition/src/helpers/candidates/candidate-files.js';
import { buildCompositionInputHash } from '../../steps/composition/src/helpers/candidates/composition-cache-key.js';
import { collectManifestDocEdges } from '../../steps/composition/src/helpers/edges/manifest-doc-evidence.js';
import { findSlotCycles } from '../../steps/composition/src/helpers/cycles/find-slot-cycles.js';
import { suggestCycleBreakEdge } from '../../steps/composition/src/helpers/cycles/suggest-cycle-break-edge.js';
import { parsePromptOverrides } from '../../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import { resolvePromptOverride } from '../../agents/helpers/prompt-overrides/resolve-prompt-override.js';
import { runAgent } from '../../agents/services/run-agent.js';
import {
  createStep,
  getCliCacheVersion,
  getOrCreateSession,
  openPipelineDb,
  storeRawComponents,
  storeScannedFiles,
  storeSlotCycles,
  updateStep,
} from '../../persistence/src/session/repositories/db.js';
import { lookupCompositionCache, storeCompositionCache } from '../../persistence/src/session/cache/composition.js';
import { emitPreClassificationExclusions } from './helpers/emit-pre-classification-exclusions.js';
import { extractComponentsWithCache } from './helpers/extract-components-with-cache.js';
import { persistExtractCache } from './helpers/persist-extract-cache.js';
import { readCandidateFiles } from './helpers/read-candidate-files.js';
import { resolveCompositionAgentName } from './helpers/resolve-composition-agent-name.js';
import { retryDatabaseWrite } from './helpers/retry-database-write.js';
import type { EdgeConflict } from '../../steps/composition/src/helpers/edges/merge-edges.js';
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

    // TODO(analytics): lift to backend-pipeline so this fires for both callers.
    //   await bindAnalyticsSessionId(sessionId);
    //   if (!isPipelineAnalyticsChild()) await emitSessionStarted('analyze_extract');

    const stepId = createStep(db, sessionId, 'analyze extract', { project: projectPath });

    if (cacheHits === 0 && !noCache) {
      await persistExtractCache(db, sourceFiles, extraction.components, cacheVersion);
    }

    emitPreClassificationExclusions(extraction, onExclusion);

    const classifiedComponents = extraction.components.map(preClassifyComponent);
    const { components: initialValidatedComponents, warnings: filterWarnings } =
      await evaluateExtractionQuality(classifiedComponents);
    let validatedComponents = initialValidatedComponents;

    // First raw-components write — before composition so downstream stages can
    // start working while the (potentially agent-backed) mapper continues.
    storeRawComponents(db, sessionId, validatedComponents);

    // Composition mapping — extract-command.ts:411-541.
    let compositionPhase: 'done' | 'cache-hit' = 'done';
    const compositionWarnings: string[] = [];
    const conflicts: EdgeConflict[] = [];

    const sources = resolveCompositionSources({ noCache, compositionRefresh });

    const { overrides: overridesMap, errors: promptErrors } = parsePromptOverrides(promptOverrides);
    if (promptErrors.length > 0) throw new Error(`Prompt override error(s): ${promptErrors.join('; ')}`);
    const compositionOverride = overridesMap.get('composition');
    const compositionPrompt = compositionOverride ? await resolvePromptOverride(compositionOverride) : undefined;

    onProgress?.({ kind: 'composition', phase: 'resolving' });
    const allFiles = await readCandidateFiles(validatedComponents, sourceFiles);
    const selectedCandidates = selectCandidateFiles(allFiles).map((c) => ({ path: c.path, content: c.content }));
    const capped = capCandidatesToPromptBudget(selectedCandidates);
    const promptFiles = capped.kept;
    if (capped.dropped.length > 0) {
      compositionWarnings.push(
        `composition — ${capped.dropped.length} candidate file(s) omitted from the agent prompt to fit the context budget; resolution runs on the ${promptFiles.length} highest-value files.`,
      );
    }
    const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));

    const resolverAgent = resolveCompositionAgentName(agent);
    const componentNameSet = new Set(validatedComponents.map((c) => c.name));

    let lastAgentExitCode = 0;
    const spawnAgent = async (prompt: string): Promise<string> => {
      const res = await runAgent({
        agent: resolverAgent,
        prompt,
        timeoutMs: 120_000,
        promptViaStdin: true,
        bedrock,
        onDebugEvent: (name, payload) => onDebugEvent?.('agent', { event: name, ...payload }),
      });
      lastAgentExitCode = res.exitCode;
      if (res.exitCode !== 0 && res.stderr.trim()) {
        compositionWarnings.push(`composition — agent exited ${res.exitCode}: ${res.stderr.trim()}`);
      }
      return res.stdout;
    };

    const extraEdges = collectManifestDocEdges(runtimeFiles, validatedComponents, componentNameSet);
    const agentCacheKey = buildCompositionInputHash({ files: promptFiles, agent: resolverAgent });

    let didHitCompositionCache = false;
    const result = await resolveMapping({
      components: validatedComponents,
      ...(extraEdges.length > 0 ? { extraEdges } : {}),
      forceAgent: sources.forceAgent,
      files: promptFiles,
      ...(compositionPrompt ? { promptOverride: compositionPrompt } : {}),
      runAgentFn: async ({ prompt }) => {
        if (!noCache && !compositionRefresh) {
          const cached = lookupCompositionCache(db, agentCacheKey, cacheVersion);
          if (cached !== null) {
            didHitCompositionCache = true;
            onProgress?.({ kind: 'composition', phase: 'cache-hit' });
            return cached;
          }
        }
        onProgress?.({ kind: 'composition', phase: `agent:${resolverAgent}` });
        const stdout = await spawnAgent(prompt);
        if (lastAgentExitCode === 0) storeCompositionCache(db, agentCacheKey, cacheVersion, stdout);
        return stdout;
      },
    });
    compositionPhase = didHitCompositionCache ? 'cache-hit' : 'done';
    onProgress?.({ kind: 'composition', phase: 'done' });

    for (const w of result.warnings) compositionWarnings.push(`composition — ${w}`);
    for (const c of result.conflicts) {
      compositionWarnings.push(`composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}`);
      conflicts.push(c);
    }

    validatedComponents = result.components as typeof validatedComponents;

    // Final writes — extract-command.ts:543-563.
    await retryDatabaseWrite(() => storeRawComponents(db, sessionId, validatedComponents, { preserveStatus: true }));

    const cycleInput = validatedComponents.map((c) => ({
      name: c.name,
      slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
    }));
    const cycles = findSlotCycles(cycleInput);
    const withBreaks = cycles.map((cycle) => ({ ...cycle, suggestedBreak: suggestCycleBreakEdge(cycle, cycles) }));
    await retryDatabaseWrite(() => storeSlotCycles(db, sessionId, withBreaks));

    storeScannedFiles(
      db,
      sessionId,
      sourceFiles.map((f) => relative(projectPath, f)),
    );
    await retryDatabaseWrite(() => updateStep(db, stepId, 'complete', { sessionId }));

    // TODO(analytics): lift to backend-pipeline so this fires for both callers.
    //   enrichCommandResult({ extracted_component_count: validatedComponents.length });

    return {
      sessionId,
      compositionPhase,
      components: validatedComponents,
      warnings: [...extraction.warnings, ...filterWarnings],
      conflicts,
      compositionWarnings,
      scannedFileCount: sourceFiles.length,
    };
  } finally {
    db.close();
  }
}
