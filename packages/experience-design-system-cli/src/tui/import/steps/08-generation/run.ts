import { resolve } from 'node:path';
import {
  checkAgentAuth,
  MapTokensRunFailure,
  parsePromptOverrides,
  readExistingContentfulEntitiesFromSession,
  resolvePromptOverride,
  runGenerateComponentsSession,
  runExplorationDetailSession,
  runMapTokens,
  summarizeForMapTokens,
  loadExplorationRecord,
  loadExplorationRun,
  loadScopeDecisions,
  openPipelineDb,
  type AgentName,
  type GenerateComponentsProgress,
  type RunGenerateComponentsSessionResponse,
} from '@contentful/experience-design-system-backend-pipeline';
import { recordDebugEvent } from '../../../debug-store.js';
import { findSkillPath } from '../06-extraction/find-skill-path.js';
import { agentAuthMessage } from '../06-extraction/logic.js';
import { prepareMapTokens } from './map-tokens.js';
import { saveDecisions } from './save-decisions.js';
import { initialProgress } from './logic.js';

const COMPONENTS_SKILL_PATH = findSkillPath('generate-components.md');
const MAP_TOKENS_SKILL_PATH = findSkillPath('map-tokens.md');
import type { GenerationInput, GenerationProgress, GenerationResult, GenerationStepName } from './types.js';
import { throwIfAborted } from '../../cancellation.js';
import { debugCheckpointDirectory, saveDebugTokenMappingComplete } from '../../debug-resume.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DETAIL_SCOPES } from '@contentful/experience-design-system-types';

type Failure = Extract<GenerationResult, { ok: false }>;

export interface GenerationDeps {
  checkAgentAuth: typeof checkAgentAuth;
  saveDecisions: typeof saveDecisions;
  runGenerate: typeof runGenerateComponentsSession;
  runMapTokens: typeof runMapTokens;
  prepareMapTokens: typeof prepareMapTokens;
  prepareMapOptions: typeof buildMapTokensOptions;
  runDetail?: typeof runExplorationDetailSession;
}

const realDeps: GenerationDeps = {
  checkAgentAuth,
  saveDecisions,
  runGenerate: runGenerateComponentsSession,
  runMapTokens,
  prepareMapTokens,
  prepareMapOptions: buildMapTokensOptions,
  runDetail: runExplorationDetailSession,
};

const fail = (step: GenerationStepName, message: string): Failure => ({ ok: false, step, message });
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runGeneration(
  input: GenerationInput,
  onProgress: (progress: GenerationProgress) => void,
  deps: GenerationDeps = realDeps,
): Promise<GenerationResult> {
  const signal = input.signal;
  let progress = initialProgress();
  const update = (change: Partial<GenerationProgress>): void => {
    if (signal?.aborted) return;
    progress = { ...progress, ...change };
    onProgress(progress);
  };
  const accepted = input.decisions.accepted;

  let handedOverNames: string[];
  try {
    throwIfAborted(signal);
    handedOverNames = await input.cachedNames.catch((): string[] => []);
    throwIfAborted(signal);
  } catch (error) {
    return fail('generate components', errorMessage(error));
  }

  try {
    throwIfAborted(signal);
    update({ stage: 'saving-decisions' });
    if (input.debugResumeFrom === 'generation' || input.debugResumeFrom === 'tokens') {
      const db = openPipelineDb();
      try {
        if (JSON.stringify(loadScopeDecisions(db, input.sessionId)) !== JSON.stringify(input.decisions))
          throw new Error('Saved debug scope changed; resume from scope.');
      } finally {
        db.close();
      }
    } else {
      await deps.saveDecisions({ sessionId: input.sessionId, decisions: input.decisions, signal });
    }
    throwIfAborted(signal);
  } catch (error) {
    return fail('save decisions', errorMessage(error));
  }

  if (accepted.length === 0) return { ok: true, generation: { route: 'push', acceptedCount: 0 } };

  let auth: Awaited<ReturnType<GenerationDeps['checkAgentAuth']>>;
  try {
    throwIfAborted(signal);
    update({ stage: 'authenticating' });
    auth = await deps.checkAgentAuth(input.agent as AgentName);
    throwIfAborted(signal);
  } catch (error) {
    return fail(`${input.agent} auth check`, errorMessage(error));
  }
  if (auth === 'not-found' || auth === 'unauthenticated') {
    return fail(`${input.agent} auth check`, agentAuthMessage(input.agent, auth));
  }

  try {
    throwIfAborted(signal);
    const { errors } = parsePromptOverrides(input.promptOverrides);
    if (errors.length) throw new Error(errors.join('; '));
    update({ stage: 'exploring' });
    if (input.debugResumeFrom === 'generation' || input.debugResumeFrom === 'tokens') {
      const db = openPipelineDb();
      try {
        if (!loadExplorationRecord(db, input.sessionId, 'detail', 'detail'))
          throw new Error('Completed property and slot reviews unavailable; resume from details.');
      } finally {
        db.close();
      }
      update({
        exploration: { phase: 'detail', stage: 'complete', done: DETAIL_SCOPES.length, total: DETAIL_SCOPES.length },
      });
    } else {
      const detail = await deps.runDetail?.({
        sessionId: input.sessionId,
        agent: input.agent as AgentName,
        model: input.agentModel,
        selectedNames: accepted,
        promptOverrides: input.promptOverrides,
        existingEntitiesPath: input.existingEntitiesPath,
        signal,
        onActivity: (event) => update({ exploration: event }),
      });
      throwIfAborted(signal);
      if (detail && !detail.ok) return fail('explore selected components', detail.error);
    }
  } catch (error) {
    return fail('explore selected components', errorMessage(error));
  }

  const debugWrites: Promise<void>[] = [];
  let generated: RunGenerateComponentsSessionResponse;
  try {
    throwIfAborted(signal);
    await rm(join(debugCheckpointDirectory(input.sessionId), 'token-mapping.json'), { force: true });
    update({
      stage: 'generating',
      components: { done: 0, total: accepted.length, current: '' },
    });
    generated = await deps.runGenerate({
      sessionId: input.sessionId,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: appendGeneratePromptOverride(input),
      skillPath: COMPONENTS_SKILL_PATH,
      noCache: true,
      debugResume: input.debugResumeFrom === 'generation' || input.debugResumeFrom === 'tokens',
      debugRequireComplete: input.debugResumeFrom === 'tokens',
      debugArtifactDir: join(debugCheckpointDirectory(input.sessionId), 'generation'),
      signal,
      existingEntitiesPath: input.existingEntitiesPath,
      precomputedCachedNames: new Set(handedOverNames),
      onProgress: (event) => {
        const activeComponents =
          event.kind === 'component:slot-renamed'
            ? progress.activeComponents
            : progress.activeComponents.filter((active) => active.name !== event.name);
        if (event.kind === 'component:started')
          activeComponents.push({ name: event.name, attempt: event.attempt, maxAttempts: event.maxAttempts });
        if (event.kind === 'component:model-exploring')
          activeComponents.push({ name: event.name, attempt: 1, maxAttempts: 2, exploringModel: true });
        update({
          components: applyProgressEvent(event, progress.components, accepted.length),
          activeComponents,
          failedComponents: progress.failedComponents + (event.kind === 'component:failed' ? 1 : 0),
          resumedComponents: (progress.resumedComponents ?? 0) + (event.kind === 'component:resumed' ? 1 : 0),
        });
      },
      onDebugEvent: (event, payload) => {
        debugWrites.push(recordDebugEvent(event, { ...payload, sessionId: input.sessionId }));
      },
    });
    throwIfAborted(signal);
  } catch (error) {
    return fail('generate components', errorMessage(error));
  } finally {
    await Promise.allSettled(debugWrites);
  }
  if (signal?.aborted) return fail('generate components', errorMessage(new Error('The operation was aborted.')));
  if (generated.emptySession) return fail('generate components', 'no raw components in session');
  if (!generated.allOk) {
    const firstFailure = generated.results.find((r) => r.failed);
    return fail(
      'generate components',
      firstFailure ? `${firstFailure.componentName}: ${firstFailure.error ?? 'unknown error'}` : 'unknown error',
    );
  }

  let plan;
  try {
    throwIfAborted(signal);
    update({ stage: 'preparing-token-mapping' });
    plan = await deps.prepareMapTokens({ ...input, signal }, input.sessionId);
    throwIfAborted(signal);
  } catch (error) {
    return fail('map tokens', errorMessage(error));
  }
  update({ mapTokensEligible: plan.eligible });
  if (plan.eligible) {
    update({ stage: 'mapping-tokens', mapTokens: 'running' });
    try {
      throwIfAborted(signal);
      const mapTokensOptions = await deps.prepareMapOptions(input, signal);
      throwIfAborted(signal);
      await deps.runMapTokens({
        sessionId: input.sessionId,
        agent: input.agent as AgentName,
        ...(input.agentModel ? { model: input.agentModel } : {}),
        cache: !input.noCache,
        signal,
        skillPathOverride: MAP_TOKENS_SKILL_PATH,
        ...mapTokensOptions,
      });
      throwIfAborted(signal);
    } catch (error) {
      const message =
        error instanceof MapTokensRunFailure ? error.message : error instanceof Error ? error.message : String(error);
      return fail('map tokens', message);
    }
  }
  update({ stage: 'complete', mapTokens: 'complete' });
  throwIfAborted(signal);
  const db = openPipelineDb();
  try {
    await saveDebugTokenMappingComplete(input.sessionId, loadExplorationRun(db, input.sessionId, 'detail')?.runId);
  } finally {
    db.close();
  }

  await new Promise<void>((r) => setImmediate(r));
  if (signal?.aborted) return fail('generate components', 'The operation was aborted.');

  const generatedCount = generated.results.filter((r) => !r.failed).length;
  return {
    ok: true,
    generation: {
      route: 'review',
      sessionId: input.sessionId,
      acceptedCount: accepted.length,
      generatedCount,
      mapTokensEligible: plan.eligible,
    },
  };
}

async function buildMapTokensOptions(
  input: GenerationInput,
  signal?: AbortSignal,
): Promise<{ skillContentOverride?: string; skillPathOverride?: string; existingEntitiesInline?: string }> {
  throwIfAborted(signal);
  const { overrides: parsed, errors } = parsePromptOverrides(input.promptOverrides);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const mapOverride = parsed.get('map-tokens');

  const prompt: { skillContentOverride?: string; skillPathOverride?: string } = {};
  if (mapOverride?.kind === 'text') prompt.skillContentOverride = mapOverride.value;
  if (mapOverride?.kind === 'path') {
    await resolvePromptOverride(mapOverride);
    throwIfAborted(signal);
    prompt.skillPathOverride = resolve(mapOverride.value);
  }

  if (input.existingEntitiesPath) {
    const entities = await readExistingContentfulEntitiesFromSession({ path: input.existingEntitiesPath });
    throwIfAborted(signal);
    if (entities) return { ...prompt, existingEntitiesInline: JSON.stringify(summarizeForMapTokens({ entities })) };
  }
  return prompt;
}

function appendGeneratePromptOverride(input: GenerationInput): string[] {
  if (!input.generatePromptPath) return input.promptOverrides;
  const already = input.promptOverrides.some((override) => override.startsWith('generate='));
  if (already) return input.promptOverrides;
  return [...input.promptOverrides, `generate=${input.generatePromptPath}`];
}

function applyProgressEvent(
  event: GenerateComponentsProgress,
  previous: GenerationProgress['components'],
  total: number,
): GenerationProgress['components'] {
  if (event.kind === 'component:started' || event.kind === 'component:model-exploring') {
    return { done: previous?.done ?? 0, total: event.total || total, current: event.name };
  }
  if (
    event.kind === 'component:completed' ||
    event.kind === 'component:failed' ||
    event.kind === 'component:cached' ||
    event.kind === 'component:resumed'
  ) {
    return { done: (previous?.done ?? 0) + 1, total: event.total || total, current: event.name };
  }
  return previous;
}
