import { checkAgentAuth, type AgentName } from '@contentful/experience-design-system-generation';
import { agentAuthMessage } from '../06-extraction/logic.js';
import { checkGenerationCache, type CacheCheckInput } from '../07-scope-gate/cache-check.js';
import { applyGenerateStderr, initialProgress, parseGenerateResult } from './logic.js';
import { prepareMapTokens } from './map-tokens.js';
import { runMapTokens, spawnGenerate } from './processes.js';
import { saveDecisions } from './save-decisions.js';
import type { GenerationInput, GenerationProgress, GenerationResult, GenerationStepName } from './types.js';

type Failure = Extract<GenerationResult, { ok: false }>;

/** The outside world the stage talks to, so the order of events can be tested without a database, an agent or a CLI. */
export interface GenerationDeps {
  checkAgentAuth: typeof checkAgentAuth;
  saveDecisions: typeof saveDecisions;
  checkCache: (input: CacheCheckInput) => Promise<string[]>;
  spawnGenerate: typeof spawnGenerate;
  prepareMapTokens: typeof prepareMapTokens;
  runMapTokens: typeof runMapTokens;
}

const realDeps: GenerationDeps = {
  checkAgentAuth,
  saveDecisions,
  checkCache: checkGenerationCache,
  spawnGenerate,
  prepareMapTokens,
  runMapTokens,
};

const fail = (step: GenerationStepName, message: string): Failure => ({ ok: false, step, message });
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The whole stage, in the order the wizard ran it:
 *  1. Wait for the cache check that ran while the scope gate was open, then save the decisions. Both write to the
 *     pipeline database and the cache has to be restored first. With nothing accepted the stage ends here, as the wizard's did.
 *  2. If every accepted component is in the cache, take them all from it. Otherwise look at the cache again, because the
 *     earlier answer was read before the decisions were saved, and generate only what is still missing.
 *  3. Map tokens onto the generated session. Skipped when there is nothing to map.
 * A failed token mapping after a successful generation is an error to show. It neither retries nor throws away what was
 * generated.
 */
export async function runGeneration(
  input: GenerationInput,
  onProgress: (progress: GenerationProgress) => void,
  deps: GenerationDeps = realDeps,
): Promise<GenerationResult> {
  let progress = initialProgress();
  const update = (change: Partial<GenerationProgress>): void => {
    progress = { ...progress, ...change };
    onProgress(progress);
  };
  const accepted = input.decisions.accepted;

  // Let the cache restore finish before anything else writes to the database. A check that failed counts as nothing
  // cached, as it always did.
  const handedOverNames = await input.cachedNames.catch((): string[] => []);

  try {
    await deps.saveDecisions({ sessionId: input.sessionId, decisions: input.decisions });
  } catch (error) {
    return fail('save decisions', errorMessage(error));
  }

  // Nothing accepted: nothing to generate and no review, the wizard goes straight on to saving and pushing.
  if (accepted.length === 0) return { ok: true, generation: { route: 'push', acceptedCount: 0 } };

  // The agent was checked before extraction, but the user may have sat at the scope gate for a while, so it is checked
  // again right before it is used, as the wizard did.
  const auth = await deps.checkAgentAuth(input.agent as AgentName);
  if (auth === 'not-found' || auth === 'unauthenticated') {
    return fail(`${input.agent} auth check`, agentAuthMessage(input.agent, auth));
  }

  const acceptedSet = new Set(accepted);
  // `generate components` ignores --cached-components when the cache is off, so the names are only trusted with it on.
  let cachedNames = handedOverNames;
  let cacheHit = !input.noCache && accepted.length > 0 && accepted.every((name) => cachedNames.includes(name));
  if (!cacheHit && !input.noCache && accepted.length > 0) {
    const fresh = await deps.checkCache(cacheCheckFor(input));
    cachedNames = fresh.filter((name) => acceptedSet.has(name));
    cacheHit = accepted.every((name) => cachedNames.includes(name));
  }

  let generatedSessionId = input.sessionId;
  let generatedCount = accepted.length;
  if (!cacheHit) {
    const result = await deps.spawnGenerate(
      {
        sessionId: input.sessionId,
        tokensPath: input.tokensPath,
        agent: input.agent,
        ...(input.agentModel ? { agentModel: input.agentModel } : {}),
        promptOverrides: input.promptOverrides,
        ...(input.generatePromptPath ? { generatePromptPath: input.generatePromptPath } : {}),
        noCache: input.noCache,
        existingEntitiesPath: input.existingEntitiesPath,
        cachedComponents: cachedNames,
      },
      {
        onStderr: (chunk) => {
          const components = applyGenerateStderr(chunk, progress.components);
          if (components !== progress.components) update({ components });
        },
      },
    );
    if (result.exitCode !== 0) return fail('generate components', result.stderr.trim() || 'Unknown error');
    const parsed = parseGenerateResult(result, accepted.length);
    generatedSessionId = parsed.generateSessionId ?? input.sessionId;
    generatedCount = parsed.generatedCount;
  }

  let plan;
  try {
    plan = await deps.prepareMapTokens(input, generatedSessionId);
  } catch (error) {
    return fail('map tokens', errorMessage(error));
  }
  update({ mapTokensEligible: plan.eligible });
  if (plan.eligible) {
    update({ mapTokens: 'running' });
    const mapped = await deps.runMapTokens({
      sessionId: generatedSessionId,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: input.promptOverrides,
      noCache: input.noCache,
      existingEntitiesPath: input.existingEntitiesPath,
    });
    if (mapped.exitCode !== 0) return fail('map tokens', mapped.stderr.trim() || 'Unknown error');
  }
  update({ mapTokens: 'complete' });

  return {
    ok: true,
    generation: {
      route: 'review',
      sessionId: generatedSessionId,
      acceptedCount: accepted.length,
      generatedCount,
      mapTokensEligible: plan.eligible,
    },
  };
}

function cacheCheckFor(input: GenerationInput): CacheCheckInput {
  return {
    sessionId: input.sessionId,
    tokensPath: input.tokensPath,
    agent: input.agent,
    ...(input.agentModel ? { agentModel: input.agentModel } : {}),
    promptOverrides: input.promptOverrides,
    existingEntitiesPath: input.existingEntitiesPath,
    noCache: input.noCache,
  };
}
