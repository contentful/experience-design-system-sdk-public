import { mkdir, readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import {
  evaluateExtractionQuality,
  preClassifyComponent,
  preClassifyProp,
} from '@contentful/experience-design-system-extraction';
import { extractComponents } from '../steps/extraction/src/controller/extract-components-endpoint.js';
import { resolveMapping } from '../steps/composition/src/helpers/edges/resolve-mapping.js';
import { resolveCompositionSources } from '../steps/composition/src/helpers/edges/resolve-composition-sources.js';
import {
  selectCandidateFiles,
  capCandidatesToPromptBudget,
} from '../steps/composition/src/helpers/candidates/candidate-files.js';
import { buildCompositionInputHash } from '../steps/composition/src/helpers/candidates/composition-cache-key.js';
import { collectManifestDocEdges } from '../steps/composition/src/helpers/edges/manifest-doc-evidence.js';
import { findSlotCycles } from '../steps/composition/src/helpers/cycles/find-slot-cycles.js';
import { suggestCycleBreakEdge } from '../steps/composition/src/helpers/cycles/suggest-cycle-break-edge.js';
import { parsePromptOverrides } from '../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import { resolvePromptOverride } from '../agents/helpers/prompt-overrides/resolve-prompt-override.js';
import { runAgent } from '../agents/services/run-agent.js';
import { DEFAULT_AGENT_NAME } from '../agents/constants/models.js';
import { isAgentName } from '../agents/helpers/resolution/is-agent-name.js';
import type { AgentName } from '../agents/types/agent-name.js';
import {
  createStep,
  getCliCacheVersion,
  getOrCreateSession,
  lookupExtractCache,
  openPipelineDb,
  storeExtractCache,
  storeRawComponents,
  storeScannedFiles,
  storeSlotCycles,
  updateStep,
} from '../persistence/src/session/repositories/db.js';
import { lookupCompositionCache, storeCompositionCache } from '../persistence/src/session/cache/composition.js';
import { hashFile } from '../persistence/src/session/helpers/cache-keys.js';
import type { RawComponentDefinition } from '../steps/extraction/src/types/component.js';
import type { EdgeConflict } from '../steps/composition/src/helpers/edges/merge-edges.js';
import type { AgentDebugEvent } from '../agents/types/agent-run.js';

/**
 * Structured progress events emitted during extraction and composition.
 * Scan progress is NOT included here — callers walk the project tree
 * themselves (via `collectFiles`) and emit their own scan progress before
 * handing `filePaths` to this orchestrator.
 */
export type ExtractAndComposeProgress =
  | { kind: 'extract'; done: number; total: number; componentsSoFar: number }
  | { kind: 'composition'; phase: 'resolving' | 'cache-hit' | `agent:${string}` | 'done' };

export interface RunExtractAndComposeSessionRequest {
  /** Absolute project root. Used as the session's inputPath and for relative file-path storage. */
  projectPath: string;
  /** Absolute path to the session's output directory (typically `<projectPath>/.contentful`). */
  outDir: string;
  /** Source files (absolute paths) to extract from. Caller walks + filters (via `collectFiles`). */
  filePaths: string[];
  /** Coding agent used for composition mapping resolution (claude|codex|opencode|cursor). */
  agent: string;
  /** Optional explicit model for the agent. Not used by composition today but accepted for future use. */
  agentModel?: string;
  /** `--prompt stage=value` overrides, repeatable, as passed through from CLI/TUI. */
  promptOverrides: string[];
  /** When true: skip extract/composition caches, re-run everything. */
  noCache: boolean;
  /** How aggressively to retry extraction for unresolved Svelte Props types. Defaults to 'auto'. */
  resolveUnreachable?: 'auto' | 'always' | 'never';
  /** When true: force the composition agent to run even where deterministic sources answered. */
  compositionRefresh?: boolean;
  /** When true: enable Bedrock env for the composition agent (gated on agentSupportsBedrock). */
  bedrock?: boolean;
  /** Fires when a structured progress event occurs. */
  onProgress?: (event: ExtractAndComposeProgress) => void;
  /** Fires exactly once with the newly-minted sessionId, as early as possible — before any heavy work. Awaited. */
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
  /** Optional debug event sink; callers own how/where events get logged. */
  onDebugEvent?: AgentDebugEvent;
  /** Optional filter-exclusion sink; callers own how/where exclusions get logged. */
  onExclusion?: (exclusion: Record<string, unknown>) => void;
}

export interface RunExtractAndComposeSessionResponse {
  /** Pipeline session id. Downstream commands (select, generate, apply) read the session by this id. */
  sessionId: string;
  /** Which path composition resolution took. Carried into the handoff to v1's scope gate. */
  compositionPhase: 'done' | 'cache-hit';
  /** Final composition-enriched components. Same shape stored to the DB. */
  components: RawComponentDefinition[];
  /** Union of extraction warnings and quality-filter warnings. */
  warnings: string[];
  /** Composition edge conflicts, if any. */
  conflicts: EdgeConflict[];
  /** Composition warnings (dropped candidates, agent exit non-zero, etc.). */
  compositionWarnings: string[];
  /** Count of source files scanned (equal to `request.filePaths.length`). */
  scannedFileCount: number;
}

async function retryDatabaseWrite<T>(operation: () => T, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|database is busy/i.test(message) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 2000)));
    }
  }
}

/** Resolve which coding-agent runs mapping resolution: explicit flag > env > default. */
function resolveCompositionAgentName(flagValue?: string): AgentName {
  if (flagValue && isAgentName(flagValue)) return flagValue;
  const env = process.env['EDS_COMPOSITION_AGENT'];
  if (env && isAgentName(env)) return env;
  return DEFAULT_AGENT_NAME;
}

/**
 * Read source files whose component extractor identified them, plus any extra
 * files listed, so the candidate pre-filter can pick the relevant ones. Reads
 * each unique path once; missing files are skipped.
 */
async function readCandidateFiles(
  components: Array<{ sourcePath?: string; source?: string }>,
  extraFiles: string[] = [],
): Promise<Array<{ path: string; content: string }>> {
  const paths = new Set<string>(extraFiles);
  for (const c of components) {
    if (c.sourcePath) paths.add(c.sourcePath);
  }
  const out: Array<{ path: string; content: string }> = [];
  await Promise.all(
    [...paths].map(async (p) => {
      try {
        const content = await readFile(p, 'utf8');
        out.push({ path: p, content });
      } catch {
        void 0;
      }
    }),
  );
  return out;
}

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
    filePaths,
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

  const sourceFiles = filePaths;

  // Extraction cache lookup — identical to extract-command.ts:303-346
  const extractionCacheDb = openPipelineDb();
  let extraction: Awaited<ReturnType<typeof extractComponents>>;
  let extractionCacheHits = 0;
  try {
    const cacheVersion = await getCliCacheVersion();
    const cachedByPath = new Map<string, Awaited<ReturnType<typeof lookupExtractCache>>>();
    if (!noCache && sourceFiles.length > 0) {
      const hashes = await Promise.all(
        sourceFiles.map(async (filePath) => [filePath, await hashFile(filePath)] as const),
      );
      for (const [filePath, fileHash] of hashes) {
        cachedByPath.set(filePath, lookupExtractCache(extractionCacheDb, fileHash, cacheVersion));
      }
    }

    const allFilesCached =
      !noCache && sourceFiles.length > 0 && sourceFiles.every((filePath) => cachedByPath.get(filePath) !== null);
    if (allFilesCached) {
      const cachedComponents = sourceFiles.flatMap((filePath) => cachedByPath.get(filePath)!.components);
      extractionCacheHits = sourceFiles.length;
      extraction = { components: cachedComponents, warnings: [], exclusions: [] };
      onProgress?.({
        kind: 'extract',
        done: sourceFiles.length,
        total: sourceFiles.length,
        componentsSoFar: cachedComponents.length,
      });
      onDebugEvent?.('analyze', {
        kind: 'extract.cache-hit',
        files: sourceFiles.length,
        components: cachedComponents.length,
      });
    } else {
      extraction = await extractComponents({
        filePaths: sourceFiles,
        projectRoot: projectPath,
        opts: { resolveUnreachable },
        onProgress: ({ filesProcessed, componentsFound }) => {
          onProgress?.({
            kind: 'extract',
            done: filesProcessed,
            total: sourceFiles.length,
            componentsSoFar: componentsFound,
          });
        },
      });
    }
  } finally {
    extractionCacheDb.close();
  }

  await mkdir(outDir, { recursive: true });

  // Open the session DB and mint the session — extract-command.ts:350-362
  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, undefined, undefined, {
    command: 'analyze extract',
    inputPath: projectPath,
    outDir,
  });
  // Caller can start downstream work (e.g. selection lane in the TUI) now.
  await onSessionCreated?.(sessionId);

  // TODO(analytics): lift to backend-pipeline so this fires for both callers.
  //   await bindAnalyticsSessionId(sessionId);
  //   if (!isPipelineAnalyticsChild()) await emitSessionStarted('analyze_extract');

  const stepId = createStep(db, sessionId, 'analyze extract', { project: projectPath });

  // Persist extract cache on cache-miss path — extract-command.ts:363-381
  if (extractionCacheHits === 0 && !noCache) {
    const cacheVersion = await getCliCacheVersion();
    const componentsBySourcePath = new Map<string, typeof extraction.components>();
    for (const component of extraction.components) {
      if (!component.sourcePath) continue;
      const components = componentsBySourcePath.get(component.sourcePath) ?? [];
      components.push(component);
      componentsBySourcePath.set(component.sourcePath, components);
    }
    for (const filePath of sourceFiles) {
      storeExtractCache(
        db,
        filePath,
        await hashFile(filePath),
        cacheVersion,
        componentsBySourcePath.get(filePath) ?? [],
      );
    }
  }

  // Pre-classification + exclusion logging — extract-command.ts:382-399
  const classifiedComponents = extraction.components.map(preClassifyComponent);
  for (const exclusion of extraction.exclusions ?? []) {
    onExclusion?.({ ...exclusion });
  }
  for (const component of extraction.components) {
    for (const prop of component.props) {
      if (preClassifyProp(prop)?.category === 'exclude') {
        onExclusion?.({
          itemType: 'prop',
          name: prop.name,
          source: component.source,
          component: component.name,
          reason: 'deterministic pre-classification excluded this wiring prop',
          stage: 'pre-classify',
        });
      }
    }
  }

  // Quality evaluation + first raw-components write — extract-command.ts:400-409
  const { components: initialValidatedComponents, warnings: filterWarnings } =
    await evaluateExtractionQuality(classifiedComponents);
  let validatedComponents = initialValidatedComponents;

  storeRawComponents(db, sessionId, validatedComponents);

  // Composition mapping — extract-command.ts:411-541
  let compositionPhase: 'done' | 'cache-hit' = 'done';
  const compositionWarnings: string[] = [];
  const conflicts: EdgeConflict[] = [];

  const sources = resolveCompositionSources({ noCache, compositionRefresh });

  const { overrides: promptOverridesMap, errors: promptErrors } = parsePromptOverrides(promptOverrides);
  if (promptErrors.length > 0) {
    throw new Error(`Prompt override error(s): ${promptErrors.join('; ')}`);
  }
  let compositionPrompt: string | undefined;
  const compositionOverride = promptOverridesMap.get('composition');
  if (compositionOverride) {
    compositionPrompt = await resolvePromptOverride(compositionOverride);
  }

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
  const cacheVersion = await getCliCacheVersion();

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

  const manifestDocEdges = collectManifestDocEdges(runtimeFiles, validatedComponents, componentNameSet);
  const extraEdges = manifestDocEdges;

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
      if (lastAgentExitCode === 0) {
        storeCompositionCache(db, agentCacheKey, cacheVersion, stdout);
      }
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

  // Final writes — extract-command.ts:543-563
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

  db.close();

  const allWarnings = [...extraction.warnings, ...filterWarnings];
  return {
    sessionId,
    compositionPhase,
    components: validatedComponents,
    warnings: allWarnings,
    conflicts,
    compositionWarnings,
    scannedFileCount: sourceFiles.length,
  };
}
