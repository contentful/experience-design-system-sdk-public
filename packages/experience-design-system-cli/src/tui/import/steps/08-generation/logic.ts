import type { RunningLine } from '../../shared/running-step/logic.js';
import { describeAgentActivity } from '../../shared/agent-activity.js';
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
  return {
    stage: 'preparing',
    activeComponents: [],
    failedComponents: 0,
    components: null,
    mapTokens: 'idle',
    mapTokensEligible: null,
  };
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

export function progressRows(progress: GenerationProgress, agent: string): RunningLine[] {
  const name = capitalize(agent);
  const { components, mapTokens, exploration, stage } = progress;
  const rows: RunningLine[] = [];
  if (exploration) {
    const scopeNumber = exploration.scope?.match(/-(\d+)$/)?.[1];
    const labels: Record<typeof exploration.stage, string> = {
      loading: 'Loading source evidence for property and slot reviews...',
      preparing: 'Preparing property and slot reviews...',
      cached: 'Reusing saved property and slot review...',
      exploring: `Reviewing properties and slots via ${name}${scopeNumber ? ` — review pass ${scopeNumber} of ${exploration.total}` : ''}`,
      reconciling: `Comparing reviews and classifying disagreements via ${name}...`,
      verifying: `Verifying disputed findings against source evidence via ${name}...`,
      checking: `Checking evidence supporting verified findings via ${name}...`,
      finalizing: 'Saving property and slot review results...',
      complete: 'Property and slot reviews complete',
    };
    rows.push({
      id: 'exploration',
      text: labels[exploration.stage],
      detail: describeAgentActivity(exploration.invocation),
      complete: exploration.stage === 'complete',
      ...(['exploring', 'cached'].includes(exploration.stage)
        ? { progress: { done: exploration.done, total: exploration.total, label: 'review passes complete' } }
        : {}),
    });
  }
  if (['preparing', 'saving-decisions', 'authenticating'].includes(stage)) {
    rows.push({
      id: 'preparation',
      text:
        stage === 'authenticating'
          ? `Checking ${name} authentication...`
          : stage === 'saving-decisions'
            ? 'Saving selected components...'
            : 'Preparing selected components...',
    });
  } else if (stage === 'exploring' && !exploration) {
    rows.push({ id: 'preparation', text: 'Preparing property and slot reviews...' });
  }
  if (components) {
    if (progress.resumedComponents)
      rows.push({
        id: 'resumed-definitions',
        text: `Reused ${progress.resumedComponents} completed component definitions from this debug session`,
        complete: true,
      });
    const finished = components.done >= components.total && progress.activeComponents.length === 0;
    rows.push({
      id: 'definitions',
      text: finished
        ? progress.failedComponents
          ? `Definition generation finished — ${progress.failedComponents} failed`
          : 'Component definitions ready'
        : `Generating component definitions via ${name}...`,
      complete: finished,
      failed: finished && progress.failedComponents > 0,
      progress: { done: components.done, total: components.total, label: 'components processed' },
    });
    for (const active of progress.activeComponents) {
      rows.push({
        id: `component:${active.name}`,
        text: active.exploringModel
          ? `Exploring a new model Component for ${active.name}`
          : active.attempt > 1
            ? `Retrying ${active.name} — attempt ${active.attempt} of ${active.maxAttempts}`
            : `Generating ${active.name}`,
      });
    }
    if (!finished && !progress.activeComponents.length)
      rows.push({ id: 'next-definition', text: 'Preparing the next component definition...' });
  }
  if (stage === 'preparing-token-mapping') {
    rows.push({ id: 'token-eligibility', text: 'Checking which properties can use design tokens...' });
  }
  if (mapTokens !== 'idle') {
    rows.push({
      id: 'token-mapping',
      text: mapTokens === 'running' ? `Mapping token restrictions via ${name}...` : 'Token restrictions ready',
      complete: mapTokens === 'complete',
    });
  }
  return rows;
}
