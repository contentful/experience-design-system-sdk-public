import { resolve } from 'node:path';
import { checkAgentAuth } from '../../agents/services/check-agent-auth.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../agents/index.js';
import type { AgentName } from '../../agents/types/agent-name.js';
import { readExistingContentfulEntitiesFromSession } from '../../steps/generation/src/controller/existing-entities/read-from-session.js';
import { summarizeForMapTokens } from '../../steps/generation/src/controller/existing-entities/summarize-for-map-tokens.js';
import { runMapTokens, MapTokensRunFailure } from '../../steps/generation/src/controller/map-tokens/run-map-tokens.js';
import {
  runGenerateComponentsSession,
  type RunGenerateComponentsSessionResponse,
} from '../run-generate-components-session/run-generate-components-session.js';
import { prepareMapTokens } from './helpers/prepare-map-tokens.js';
import { saveDecisions } from './helpers/save-decisions.js';
import type {
  ImportGenerationInput,
  ImportGenerationProgress,
  ImportGenerationResult,
  ImportGenerationStepName,
} from './types.js';

type Failure = Extract<ImportGenerationResult, { ok: false }>;

export interface ImportGenerationDeps {
  checkAgentAuth: typeof checkAgentAuth;
  saveDecisions: typeof saveDecisions;
  runGenerate: typeof runGenerateComponentsSession;
  runMapTokens: typeof runMapTokens;
  prepareMapTokens: typeof prepareMapTokens;
}

const realDeps: ImportGenerationDeps = {
  checkAgentAuth,
  saveDecisions,
  runGenerate: runGenerateComponentsSession,
  runMapTokens,
  prepareMapTokens,
};

const fail = (step: ImportGenerationStepName, message: string): Failure => ({ ok: false, step, message });
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runImportGeneration(
  input: ImportGenerationInput,
  onProgress: (progress: ImportGenerationProgress) => void,
  deps: ImportGenerationDeps = realDeps,
): Promise<ImportGenerationResult> {
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
    return {
      ...fail(
        `${input.agent} auth check`,
        `Agent ${input.agent} is ${auth === 'not-found' ? 'not found' : 'not authenticated'}.`,
      ),
      authStatus: auth,
    };
  }

  let generated: RunGenerateComponentsSessionResponse;
  try {
    generated = await deps.runGenerate({
      sessionId: input.sessionId,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: appendGeneratePromptOverride(input),
      skillPath: input.componentsSkillPath,
      noCache: input.noCache,
      existingEntitiesPath: input.existingEntitiesPath,
      precomputedCachedNames: new Set(handedOverNames),
      onProgress: (event) => onProgress({ kind: 'components', event }),
    });
  } catch (error) {
    return fail('generate components', errorMessage(error));
  }
  if (generated.emptySession) return fail('generate components', 'no raw components in session');
  if (!generated.allOk) {
    const firstFailure = generated.results.find((r) => r.failed && r.failureKind !== 'preflight');
    if (firstFailure) return fail('generate components', firstFailure.error ?? 'unknown error');
    if (!generated.results.some((result) => result.failed)) return fail('generate components', 'unknown error');
  }

  let plan;
  try {
    plan = await deps.prepareMapTokens(input, input.sessionId);
  } catch (error) {
    return fail('map tokens', errorMessage(error));
  }
  if (plan.eligible) {
    onProgress({ kind: 'map-tokens', eligible: plan.eligible, state: 'running' });
    try {
      const mapTokensOptions = await buildMapTokensOptions(input);
      await deps.runMapTokens({
        sessionId: input.sessionId,
        agent: input.agent as AgentName,
        ...(input.agentModel ? { model: input.agentModel } : {}),
        cache: !input.noCache,
        skillPathOverride: input.mapTokensSkillPath,
        ...mapTokensOptions,
      });
    } catch (error) {
      const message =
        error instanceof MapTokensRunFailure ? error.message : error instanceof Error ? error.message : String(error);
      return fail('map tokens', message);
    }
  }
  onProgress({ kind: 'map-tokens', eligible: plan.eligible, state: 'complete' });

  const generatedCount = generated.results.filter((r) => !r.failed).length;
  return {
    ok: true,
    generation: {
      route: 'review',
      sessionId: input.sessionId,
      acceptedCount: accepted.length,
      generatedCount,
      ...(generated.results.some((result) => result.failed && result.failureKind === 'preflight')
        ? {
            generationIssues: generated.results
              .filter((result) => result.failed && result.failureKind === 'preflight')
              .map((result) => ({
                componentName: result.componentName,
                error: result.error ?? 'Generation preflight failed',
              })),
          }
        : {}),
      mapTokensEligible: plan.eligible,
    },
  };
}

async function buildMapTokensOptions(
  input: ImportGenerationInput,
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

function appendGeneratePromptOverride(input: ImportGenerationInput): string[] {
  if (!input.generatePromptPath) return input.promptOverrides;
  const already = input.promptOverrides.some((override) => override.startsWith('generate='));
  if (already) return input.promptOverrides;
  return [...input.promptOverrides, `generate=${input.generatePromptPath}`];
}
