import type { DatabaseSync } from 'node:sqlite';
import { buildCompositionInputHash } from '../../../steps/composition/src/helpers/candidates/composition-cache-key.js';
import { collectManifestDocEdges } from '../../../steps/composition/src/helpers/edges/manifest-doc-evidence.js';
import { resolveMapping } from '../../../steps/composition/src/helpers/edges/resolve-mapping.js';
import { collectSourceCallSiteEvidence } from '../../../steps/composition/src/helpers/edges/source-call-site-evidence.js';
import type { ResolveCompositionServiceResult } from '../../../steps/composition/src/types/contract.js';
import { lookupCompositionCache, storeCompositionCache } from '../../../persistence/src/session/repositories/db.js';
import { runAgent } from '../../../agents/services/run-agent.js';
import { resolveCompositionAgentName } from './resolve-composition-agent-name.js';
import { selectCompositionPromptFiles } from './select-composition-prompt-files.js';
import type { AgentDebugEvent } from '../../../agents/types/agent-run.js';
import type { EdgeConflict } from '../../../steps/composition/src/helpers/edges/merge-edges.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { ExtractAndComposeProgress } from '../types.js';
import { throwIfAborted } from '../../../helpers/abort.js';
import type { SourceCapture } from '../../../steps/extraction/index.js';
import { deriveComponentId } from '../../../persistence/src/session/helpers/components/derive-component-id.js';

export interface ResolveCompositionRequest {
  db: DatabaseSync;
  signal?: AbortSignal;
  components: RawComponentDefinition[];
  sourceFiles: string[];
  sourceCapture?: SourceCapture;
  cacheVersion: string;
  noCache: boolean;
  compositionRefresh: boolean;
  /** When true, force the agent to run even over fully-resolved residue. */
  forceAgent: boolean;
  /** Optional composition prompt from `--prompt composition=…` resolution. */
  compositionPrompt: string | undefined;
  /** Caller-selected agent (CLI flag or TUI setting). */
  agent: string;
  bedrock: boolean;
  onProgress?: (event: ExtractAndComposeProgress) => void;
  onDebugEvent?: AgentDebugEvent;
}

export interface ResolveCompositionResult extends ResolveCompositionServiceResult {
  /** Composition-enriched components (same input shape, mutated edges). */
  components: RawComponentDefinition[];
  /** Which path composition took. Carried into the handoff to v1's scope gate. */
  phase: 'done' | 'cache-hit';
  /** Composition edge conflicts, if any. */
  conflicts: EdgeConflict[];
  /** User-visible warnings — dropped candidates, agent non-zero exit, resolveMapping warnings/conflicts. */
  warnings: string[];
}

/**
 * Composition mapping — the second half of extract-and-compose.
 *
 * Runs unconditionally so structural evidence (typed slots + Signal A/B/C/D)
 * and manifest/doc edges always reach the selection UI. The agent inside
 * `resolveMapping` is still gated separately — when neither `--composition-refresh`
 * nor `--no-cache` is passed, the deterministic passes still merge and apply,
 * but no LLM call is made.
 *
 * Agent output is cached under `agentCacheKey` (prompt files + agent identity)
 * and only stored when the agent exits cleanly, so a non-zero exit (e.g. a
 * context-window overflow) doesn't poison the cache and replay the error on
 * every subsequent run.
 */
export async function resolveComposition(request: ResolveCompositionRequest): Promise<ResolveCompositionResult> {
  const {
    db,
    components,
    sourceFiles,
    sourceCapture,
    cacheVersion,
    noCache,
    compositionRefresh,
    forceAgent,
    compositionPrompt,
    agent,
    bedrock,
    onProgress,
    onDebugEvent,
  } = request;

  throwIfAborted(request.signal);
  const warnings: string[] = [];

  onProgress?.({ kind: 'composition', phase: 'resolving' });

  const { promptFiles, runtimeFiles, droppedWarning } = await selectCompositionPromptFiles(
    components,
    sourceFiles,
    sourceCapture,
  );
  throwIfAborted(request.signal);
  if (droppedWarning) warnings.push(droppedWarning);

  const resolverAgent = resolveCompositionAgentName(agent);
  const componentNameSet = new Set(components.map((c) => c.name));

  let lastAgentExitCode = 0;
  const spawnAgent = async (prompt: string): Promise<string> => {
    const res = await runAgent({
      agent: resolverAgent,
      prompt,
      timeoutMs: 120_000,
      promptViaStdin: true,
      bedrock,
      signal: request.signal,
      onDebugEvent: (name, payload) => onDebugEvent?.('agent', { event: name, ...payload }),
    });
    throwIfAborted(request.signal);
    lastAgentExitCode = res.exitCode;
    if (res.exitCode !== 0 && res.stderr.trim()) {
      warnings.push(`composition — agent exited ${res.exitCode}: ${res.stderr.trim()}`);
    }
    return res.stdout;
  };

  const capturedPathsByComponent = new Map<string, Set<string>>();
  for (const file of sourceCapture?.files ?? []) {
    for (const ref of file.componentRefs) {
      if (!ref.roles.includes('definition')) continue;
      const identity = JSON.stringify([ref.componentId, ref.name]);
      const paths = capturedPathsByComponent.get(identity) ?? new Set<string>();
      paths.add(file.canonicalPath);
      capturedPathsByComponent.set(identity, paths);
    }
  }
  // Bind deterministic collectors to captured identities without changing public component source paths.
  const evidenceComponents = components.map((component) => {
    const identity = JSON.stringify([deriveComponentId(component.name, component.source), component.name]);
    const paths = capturedPathsByComponent.get(identity);
    return paths?.size === 1 ? { ...component, sourcePath: [...paths][0] } : component;
  });
  const extraEdges = collectManifestDocEdges(runtimeFiles, evidenceComponents, componentNameSet);
  const sourceCallSites = collectSourceCallSiteEvidence(runtimeFiles, evidenceComponents);
  const agentCacheKey = buildCompositionInputHash({ files: promptFiles, agent: resolverAgent });

  let didHitCompositionCache = false;
  const result = await resolveMapping({
    components,
    ...(extraEdges.length > 0 ? { extraEdges } : {}),
    sourceCallSiteEvidence: sourceCallSites.accepted,
    sourceCallSiteRejections: sourceCallSites.rejected,
    sourceCallSiteCoverage: sourceCallSites.coverage,
    forceAgent,
    files: promptFiles,
    ...(compositionPrompt ? { promptOverride: compositionPrompt } : {}),
    runAgentFn: async ({ prompt }) => {
      if (!noCache && !compositionRefresh) {
        const cached = lookupCompositionCache(db, agentCacheKey, cacheVersion);
        throwIfAborted(request.signal);
        if (cached !== null) {
          didHitCompositionCache = true;
          onProgress?.({ kind: 'composition', phase: 'cache-hit' });
          return cached;
        }
      }
      onProgress?.({ kind: 'composition', phase: `agent:${resolverAgent}` });
      const stdout = await spawnAgent(prompt);
      throwIfAborted(request.signal);
      if (lastAgentExitCode === 0) storeCompositionCache(db, agentCacheKey, cacheVersion, stdout);
      return stdout;
    },
  });
  throwIfAborted(request.signal);

  onProgress?.({ kind: 'composition', phase: 'done' });

  for (const w of result.warnings) warnings.push(`composition — ${w}`);
  const conflicts: EdgeConflict[] = [];
  for (const c of result.conflicts) {
    warnings.push(`composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}`);
    conflicts.push(c);
  }

  return {
    components: result.components as RawComponentDefinition[],
    phase: didHitCompositionCache ? 'cache-hit' : 'done',
    conflicts,
    warnings,
    sourceCallSiteEvidence: result.sourceCallSiteEvidence,
    sourceCallSiteRejections: result.sourceCallSiteRejections,
    sourceCallSiteCoverage: result.sourceCallSiteCoverage,
  };
}
