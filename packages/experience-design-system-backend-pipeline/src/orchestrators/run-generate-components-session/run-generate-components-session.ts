import { createLocalCliAgentInvoker } from '../../agents/invoker/create-local-cli-agent-invoker.js';
import type { AgentName } from '../../agents/types/agent-name.js';
import {
  loadCompletedSourceEvidence,
  loadExtractionSourceDiagnostics,
  loadRawComponents,
  openPipelineDb,
  evaluateComponentReadiness,
} from '../../persistence/src/session/repositories/db.js';
import { hashContent, hashPromptForSkill } from '../../persistence/src/session/helpers/cache-keys.js';
import { loadAcceptedNames } from '../../persistence/src/index.js';
import { summarizeForMapTokens } from '../../steps/generation/src/controller/existing-entities/summarize-for-map-tokens.js';
import { buildEmptySessionResponse } from './helpers/build-empty-session-response.js';
import { collectDuplicateNames } from './helpers/collect-duplicate-names.js';
import { filterDroppedAllowedComponents } from './helpers/filter-dropped-allowed-components.js';
import { readExistingEntities } from './helpers/read-existing-entities.js';
import { resolveGeneratePrompt } from './helpers/resolve-generate-prompt.js';
import { runOneGenerateComponent } from './helpers/run-one-generate-component.js';
import { runWithPool } from './helpers/run-with-pool.js';
import { bindAnalyticsSessionId } from '../../analytics/index.js';
import type { RunGenerateComponentsSessionRequest, RunGenerateComponentsSessionResponse } from './types.js';
import { throwIfAborted } from '../../helpers/abort.js';
import { buildCompilerEvidenceInline } from '../../agents/prompts/helpers/build-compiler-evidence-inline.js';
import {
  loadAcceptedSlotDecisions,
  loadExplorationRecord,
  loadExplorationRun,
} from '../../persistence/src/session/repositories/exploration/records.js';
import { projectAcceptedRawSlots } from '../../steps/exploration/src/services/project-accepted-slots.js';
import { loadScopeDecisions } from '../../persistence/src/session/repositories/db.js';
import { buildCachedComponentResult } from './helpers/build-cached-component-result.js';

export type {
  GenerateComponentsProgress,
  GeneratedComponentResult,
  RunGenerateComponentsSessionRequest,
  RunGenerateComponentsSessionResponse,
} from './types.js';
export {
  checkGenerateComponentsCache,
  type CheckGenerateComponentsCacheRequest,
  type CheckGenerateComponentsCacheResponse,
} from './check-generate-components-cache.js';

const DEFAULT_COMPONENT_CONCURRENCY = Number(process.env['EDS_GENERATE_CONCURRENCY'] ?? 10);

export async function runGenerateComponentsSession(
  request: RunGenerateComponentsSessionRequest,
): Promise<RunGenerateComponentsSessionResponse> {
  throwIfAborted(request.signal);
  const prompt = await resolveGeneratePrompt(request.promptOverrides);
  throwIfAborted(request.signal);
  const effectiveSkillPath = prompt.path ?? request.skillPath;
  const existingEntities = await readExistingEntities(request);
  throwIfAborted(request.signal);
  const existingTokensInline = existingEntities
    ? JSON.stringify(summarizeForMapTokens({ entities: existingEntities }))
    : undefined;
  const existingTokensHash = existingTokensInline ? [hashContent(existingTokensInline)] : [];

  const agent = request.agent as AgentName;
  const promptHash = await hashPromptForSkill(
    'components',
    agent,
    request.agentModel,
    effectiveSkillPath,
    existingTokensHash,
    prompt.text,
  );
  throwIfAborted(request.signal);

  await bindAnalyticsSessionId(request.sessionId);
  throwIfAborted(request.signal);

  const db = openPipelineDb();
  try {
    const acceptedSlots = loadAcceptedSlotDecisions(db, request.sessionId);
    const humanScope = acceptedSlots !== undefined ? loadScopeDecisions(db, request.sessionId) : undefined;
    const acceptedNames =
      acceptedSlots !== undefined
        ? humanScope
          ? new Set(humanScope.accepted)
          : null
        : await loadAcceptedNames(request.sessionId);
    throwIfAborted(request.signal);
    const savedSourceEvidence = loadCompletedSourceEvidence(db, request.sessionId);
    const sourceReady = savedSourceEvidence.readiness === 'ready';
    const extractionDiagnosticsRead = sourceReady
      ? loadExtractionSourceDiagnostics(db, request.sessionId)
      : { status: 'absent' as const };
    const extractionDiagnostics =
      extractionDiagnosticsRead.status === 'available' ? extractionDiagnosticsRead.diagnostics : undefined;
    const acceptedSet = acceptedNames ? new Set(acceptedNames) : undefined;
    if (
      acceptedSlots !== undefined &&
      (!humanScope ||
        (humanScope.accepted.length > 0 && !loadExplorationRecord(db, request.sessionId, 'detail', 'detail')))
    )
      throw new Error('Completed selected detail and human scope are required for generation');
    const explorationRunIds =
      acceptedSlots !== undefined && humanScope!.accepted.length > 0
        ? {
            componentRunId: loadExplorationRun(db, request.sessionId, 'components')!.runId,
            detailRunId: loadExplorationRun(db, request.sessionId, 'detail')!.runId,
          }
        : undefined;
    let components = loadRawComponents(db, request.sessionId, acceptedSet ?? undefined);
    components = components.map((component) => projectAcceptedRawSlots(component, acceptedSlots));
    if (components.length === 0) return buildEmptySessionResponse(request.sessionId);

    const allowedComponentNames = new Set([
      ...components.map((c) => c.name),
      ...(existingEntities?.components ?? []).map((c) => c.name),
    ]);
    const { components: filtered, dropped } =
      acceptedSlots !== undefined
        ? { components, dropped: [] }
        : filterDroppedAllowedComponents(db, request.sessionId, components, allowedComponentNames, acceptedSet);
    components = filtered;

    const duplicateNames = collectDuplicateNames(components);
    const resumed = new Set<string>();
    if (request.debugResume) {
      for (const component of components) {
        if (evaluateComponentReadiness(db, request.sessionId, component.component_id).definition.ready)
          resumed.add(component.component_id);
      }
      if (request.debugRequireComplete && resumed.size !== components.length)
        throw new Error('Some saved definitions are held or incomplete; resume from generation.');
    }
    const invoker = createLocalCliAgentInvoker({});
    const concurrency = Math.max(1, Math.min(DEFAULT_COMPONENT_CONCURRENCY, components.length));
    const results = await runWithPool(
      components,
      concurrency,
      async (component, index, signal) => {
        if (resumed.has(component.component_id)) {
          throwIfAborted(signal);
          request.onProgress?.({ kind: 'component:resumed', index, total: components.length, name: component.name });
          return { ...buildCachedComponentResult(component.name), cached: false };
        }
        return runOneGenerateComponent(
          {
            db,
            explorationRunIds,
            sessionId: request.sessionId,
            invoker,
            agent,
            model: request.agentModel,
            tokensInline: request.tokensInline,
            tokenMapInline: request.tokenMapInline,
            verbose: request.verbose ?? false,
            noCache: acceptedSlots !== undefined || request.noCache,
            skillPathOverride: effectiveSkillPath,
            skillContentOverride: prompt.text,
            promptHash,
            existingContentfulEntities: existingEntities,
            existingTokensInline,
            compilerEvidenceInline: buildCompilerEvidenceInline([component], {
              readiness: sourceReady ? 'ready' : 'unavailable',
              ...(extractionDiagnostics ? { diagnostics: extractionDiagnostics } : {}),
              diagnosticsStatus: extractionDiagnosticsRead.status,
              ...(savedSourceEvidence.readiness === 'unavailable' ? { reason: savedSourceEvidence.reason } : {}),
            }),
            precomputedCachedNames: request.precomputedCachedNames ?? new Set(),
            allowedComponentNames,
            onProgress: request.onProgress,
            onDebugEvent: request.onDebugEvent,
            debugArtifactDir: request.debugArtifactDir,
            signal,
          },
          component,
          index,
          components.length,
        );
      },
      request.signal,
    );

    const allOk = results.every((r) => !r.failed);
    const renamedSlotsCount = results.reduce((sum, r) => sum + r.renamedSlotsCount, 0);
    return {
      sessionId: request.sessionId,
      results,
      allOk,
      renamedSlotsCount,
      duplicateNames,
      droppedAllowedComponents: dropped,
      emptySession: false,
    };
  } finally {
    db.close();
  }
}
