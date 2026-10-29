import type { GenerationInput, GenerationProgress, GenerationResult } from './types.js';

/** What the debug log says the stage started with. The counts are logged, not the lists of names. */
export function generationLogInputs(input: GenerationInput): Record<string, unknown> {
  return {
    session_id: input.sessionId,
    accepted: input.decisions.accepted.length,
    rejected: input.decisions.rejected.length,
    tokens_path: input.tokensPath,
    token_session_id: input.tokenSessionId,
    existing_entities_path: input.existingEntitiesPath,
    agent: input.agent,
    agent_model: input.agentModel ?? '',
    prompt_overrides: input.promptOverrides,
    generate_prompt_path: input.generatePromptPath ?? '',
    cache: !input.noCache,
    has_tokens: input.hasTokens,
  };
}

/** How the stage ended. A failure names the step that failed (save decisions, generate components, map tokens). */
export function generationLogOutputs(
  result: GenerationResult,
  progress: GenerationProgress | undefined,
): { outputs: Record<string, unknown>; status: 'success' | 'error' } {
  const last = progress ? { final_progress: progress } : {};
  if (!result.ok) {
    return { outputs: { result: 'failed', failed_step: result.step, error: result.message, ...last }, status: 'error' };
  }
  const { generation } = result;
  return {
    outputs:
      generation.route === 'review'
        ? {
            result: 'done',
            route: generation.route,
            session_id: generation.sessionId,
            accepted: generation.acceptedCount,
            generated: generation.generatedCount,
            map_tokens_eligible: generation.mapTokensEligible,
            ...last,
          }
        : { result: 'done', route: generation.route, accepted: generation.acceptedCount, ...last },
    status: 'success',
  };
}

export function initialProgress(): GenerationProgress {
  return { components: null, mapTokens: 'idle', mapTokensEligible: null };
}

export function shouldRunMapTokens(counts: { mappablePropCount: number; rawTokenCount: number }): boolean {
  return counts.mappablePropCount > 0 && counts.rawTokenCount > 0;
}

export function formatAcceptanceSummary(counts: { accepted: number; autoRejected: number }): string {
  const accepted = `${counts.accepted} component${counts.accepted === 1 ? '' : 's'} accepted`;
  if (counts.autoRejected === 0) return `${accepted}.`;
  return `${accepted}, ${counts.autoRejected} excluded due to validation errors.`;
}

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

export function describeGeneration(input: { acceptedCount: number; agent: string; hasTokens: boolean }): string {
  const agent = capitalize(input.agent);
  return (
    `${formatAcceptanceSummary({ accepted: input.acceptedCount, autoRejected: 0 })}\n` +
    `${agent} is reading each selected component and writing a Contentful component definition for it.` +
    `${input.hasTokens ? '\nUsing your design tokens for prop resolution.' : ''}`
  );
}

export function progressRows(
  progress: GenerationProgress,
  agent: string,
): Array<{ text: string; complete: boolean; progress?: { done: number; total: number } }> {
  const name = capitalize(agent);
  const { components, mapTokens } = progress;
  const rows: Array<{ text: string; complete: boolean; progress?: { done: number; total: number } }> = [
    {
      text: components ? components.current : `Starting up ${name}...`,
      complete: false,
      ...(components ? { progress: { done: components.done, total: components.total } } : {}),
    },
  ];
  if (mapTokens !== 'idle') {
    rows.push({
      text: mapTokens === 'running' ? `Mapping token restrictions via ${name}...` : 'Token restrictions ready',
      complete: mapTokens === 'complete',
    });
  }
  return rows;
}
