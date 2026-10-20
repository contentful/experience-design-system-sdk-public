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
  type AgentName,
  type GenerateComponentsProgress,
  type RunGenerateComponentsSessionResponse,
} from '@contentful/experience-design-system-backend-pipeline';
import { recordDebugEvent } from '../../../debug-store.js';
import { findSkillPath } from '../06-extraction/find-skill-path.js';
import { agentAuthMessage } from '../06-extraction/logic.js';
import { prepareMapTokens } from './map-tokens.js';
import { saveDecisions } from './save-decisions.js';

const COMPONENTS_SKILL_PATH = findSkillPath('generate-components.md');
const MAP_TOKENS_SKILL_PATH = findSkillPath('map-tokens.md');
import type { GenerationInput, GenerationProgress, GenerationResult, GenerationStepName } from './types.js';
import { throwIfAborted } from '../../cancellation.js';

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
  let progress: GenerationProgress = { components: null, mapTokens: 'idle', mapTokensEligible: null };
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
    await deps.saveDecisions({ sessionId: input.sessionId, decisions: input.decisions, signal });
    throwIfAborted(signal);
  } catch (error) {
    return fail('save decisions', errorMessage(error));
  }

  if (accepted.length === 0) return { ok: true, generation: { route: 'push', acceptedCount: 0 } };

  let auth: Awaited<ReturnType<GenerationDeps['checkAgentAuth']>>;
  try {
    throwIfAborted(signal);
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
    const detail = await deps.runDetail?.({
      sessionId: input.sessionId,
      agent: input.agent as AgentName,
      model: input.agentModel,
      selectedNames: accepted,
      signal,
    });
    throwIfAborted(signal);
    if (detail && !detail.ok) return fail('explore selected components', detail.error);
  } catch (error) {
    return fail('explore selected components', errorMessage(error));
  }

  const debugWrites: Promise<void>[] = [];
  let generated: RunGenerateComponentsSessionResponse;
  try {
    throwIfAborted(signal);
    generated = await deps.runGenerate({
      sessionId: input.sessionId,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: appendGeneratePromptOverride(input),
      skillPath: COMPONENTS_SKILL_PATH,
      noCache: input.noCache,
      signal,
      existingEntitiesPath: input.existingEntitiesPath,
      precomputedCachedNames: new Set(handedOverNames),
      onProgress: (event) => update({ components: applyProgressEvent(event, progress.components, accepted.length) }),
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
    return fail('generate components', firstFailure?.error ?? 'unknown error');
  }

  let plan;
  try {
    throwIfAborted(signal);
    plan = await deps.prepareMapTokens({ ...input, signal }, input.sessionId);
    throwIfAborted(signal);
  } catch (error) {
    return fail('map tokens', errorMessage(error));
  }
  update({ mapTokensEligible: plan.eligible });
  if (plan.eligible) {
    update({ mapTokens: 'running' });
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
  update({ mapTokens: 'complete' });

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
  if (event.kind === 'component:started') {
    return { done: previous?.done ?? 0, total: event.total || total, current: event.name };
  }
  if (event.kind === 'component:completed' || event.kind === 'component:failed' || event.kind === 'component:cached') {
    return { done: (previous?.done ?? 0) + 1, total: event.total || total, current: event.name };
  }
  return previous;
}
