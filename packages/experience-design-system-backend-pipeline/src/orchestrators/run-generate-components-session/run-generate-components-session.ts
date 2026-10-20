import { createLocalCliAgentInvoker } from '../../agents/invoker/create-local-cli-agent-invoker.js';
import type { AgentName } from '../../agents/types/agent-name.js';
import {
  loadCompletedSourceEvidence,
  loadExtractionSourceDiagnostics,
  loadRawComponents,
  openPipelineDb,
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
    const acceptedNames = await loadAcceptedNames(request.sessionId);
    throwIfAborted(request.signal);
    const savedSourceEvidence = loadCompletedSourceEvidence(db, request.sessionId);
    const sourceReady = savedSourceEvidence.readiness === 'ready';
    const extractionDiagnosticsRead = sourceReady
      ? loadExtractionSourceDiagnostics(db, request.sessionId)
      : { status: 'absent' as const };
    const extractionDiagnostics =
      extractionDiagnosticsRead.status === 'available' ? extractionDiagnosticsRead.diagnostics : undefined;
    const acceptedSet = acceptedNames ? new Set(acceptedNames) : undefined;
    let components = loadRawComponents(db, request.sessionId, acceptedSet ?? undefined);
    if (components.length === 0) return buildEmptySessionResponse(request.sessionId);

    const allowedComponentNames = new Set([
      ...components.map((c) => c.name),
      ...(existingEntities?.components ?? []).map((c) => c.name),
    ]);
    const { components: filtered, dropped } = filterDroppedAllowedComponents(
      db,
      request.sessionId,
      components,
      allowedComponentNames,
      acceptedSet,
    );
    components = filtered;

    const duplicateNames = collectDuplicateNames(components);
    const invoker = createLocalCliAgentInvoker({});
    const concurrency = Math.max(1, Math.min(DEFAULT_COMPONENT_CONCURRENCY, components.length));
    const results = await runWithPool(
      components,
      concurrency,
      (component, index, signal) =>
        runOneGenerateComponent(
          {
            db,
            sessionId: request.sessionId,
            invoker,
            agent,
            model: request.agentModel,
            tokensInline: request.tokensInline,
            tokenMapInline: request.tokenMapInline,
            verbose: request.verbose ?? false,
            noCache: request.noCache,
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
            signal,
          },
          component,
          index,
          components.length,
        ),
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
