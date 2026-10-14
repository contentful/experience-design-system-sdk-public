import { resolve } from 'node:path';
import {
  checkAgentAuth,
  MapTokensRunFailure,
  parsePromptOverrides,
  readExistingContentfulEntitiesFromSession,
  resolvePromptOverride,
  runGenerateComponentsSession,
  runMapTokens,
  summarizeForMapTokens,
  type AgentName,
  type GenerateComponentsProgress,
  type RunGenerateComponentsSessionResponse,
} from '@contentful/experience-design-system-backend-pipeline';
import { agentAuthMessage } from '../06-extraction/logic.js';
import { prepareMapTokens } from './map-tokens.js';
import { saveDecisions } from './save-decisions.js';
import type { GenerationInput, GenerationProgress, GenerationResult, GenerationStepName } from './types.js';

type Failure = Extract<GenerationResult, { ok: false }>;

export interface GenerationDeps {
  checkAgentAuth: typeof checkAgentAuth;
  saveDecisions: typeof saveDecisions;
  runGenerate: typeof runGenerateComponentsSession;
  runMapTokens: typeof runMapTokens;
  prepareMapTokens: typeof prepareMapTokens;
}

const realDeps: GenerationDeps = {
  checkAgentAuth,
  saveDecisions,
  runGenerate: runGenerateComponentsSession,
  runMapTokens,
  prepareMapTokens,
};

const fail = (step: GenerationStepName, message: string): Failure => ({ ok: false, step, message });
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The whole stage, in the order the wizard ran it:
 *  1. Wait for the cache check that ran while the scope gate was open, then save the decisions. Both write to the
 *     pipeline database and the cache has to be restored first. With nothing accepted the stage ends here.
 *  2. Generate the accepted components in-process. The orchestrator handles per-component cache lookup, so the names
 *     from the cache check are forwarded as `precomputedCachedNames` to skip a redundant lookup.
 *  3. Map tokens onto the generated session. Skipped when there is nothing to map.
 * A failed token mapping after a successful generation is an error to show. It neither retries nor throws away what was
 * generated.
 */
export async function runGeneration(
  input: GenerationInput,
  onProgress: (progress: GenerationProgress) => void,
  deps: GenerationDeps = realDeps,
): Promise<GenerationResult> {
  let progress: GenerationProgress = { components: null, mapTokens: 'idle', mapTokensEligible: null };
  const update = (change: Partial<GenerationProgress>): void => {
    progress = { ...progress, ...change };
    onProgress(progress);
  };
  const accepted = input.decisions.accepted;

  const handedOverNames = await input.cachedNames.catch((): string[] => []);

  try {
    await deps.saveDecisions({ sessionId: input.sessionId, decisions: input.decisions });
  } catch (error) {
    return fail('save decisions', errorMessage(error));
  }

  if (accepted.length === 0) return { ok: true, generation: { route: 'push', acceptedCount: 0 } };

  const auth = await deps.checkAgentAuth(input.agent as AgentName);
  if (auth === 'not-found' || auth === 'unauthenticated') {
    return fail(`${input.agent} auth check`, agentAuthMessage(input.agent, auth));
  }

  let generated: RunGenerateComponentsSessionResponse;
  try {
    generated = await deps.runGenerate({
      sessionId: input.sessionId,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: appendGeneratePromptOverride(input),
      noCache: input.noCache,
      existingEntitiesPath: input.existingEntitiesPath,
      precomputedCachedNames: new Set(handedOverNames),
      onProgress: (event) => update({ components: applyProgressEvent(event, progress.components, accepted.length) }),
    });
  } catch (error) {
    return fail('generate components', errorMessage(error));
  }
  if (generated.emptySession) return fail('generate components', 'no raw components in session');
  if (!generated.allOk) {
    const firstFailure = generated.results.find((r) => r.failed);
    return fail('generate components', firstFailure?.error ?? 'unknown error');
  }

  let plan;
  try {
    plan = await deps.prepareMapTokens(input, input.sessionId);
  } catch (error) {
    return fail('map tokens', errorMessage(error));
  }
  update({ mapTokensEligible: plan.eligible });
  if (plan.eligible) {
    update({ mapTokens: 'running' });
    try {
      const mapTokensOptions = await buildMapTokensOptions(input);
      await deps.runMapTokens({
        sessionId: input.sessionId,
        agent: input.agent as AgentName,
        ...(input.agentModel ? { model: input.agentModel } : {}),
        cache: !input.noCache,
        ...mapTokensOptions,
      });
    } catch (error) {
      const message =
        error instanceof MapTokensRunFailure ? error.message : error instanceof Error ? error.message : String(error);
      return fail('map tokens', message);
    }
  }
  update({ mapTokens: 'complete' });

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
): Promise<{ skillContentOverride?: string; skillPathOverride?: string; existingEntitiesInline?: string }> {
  const { overrides: parsed, errors } = parsePromptOverrides(input.promptOverrides);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const mapOverride = parsed.get('map-tokens');

  const prompt: { skillContentOverride?: string; skillPathOverride?: string } = {};
  if (mapOverride?.kind === 'text') prompt.skillContentOverride = mapOverride.value;
  if (mapOverride?.kind === 'path') {
    await resolvePromptOverride(mapOverride);
    prompt.skillPathOverride = resolve(mapOverride.value);
  }

  if (input.existingEntitiesPath) {
    const entities = await readExistingContentfulEntitiesFromSession({ path: input.existingEntitiesPath });
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

/**
 * Folds a structured generate progress event into the `components` row shown on
 * screen. Mirrors the old stderr parser's semantics: `done` only climbs when a
 * component completes.
 */
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
