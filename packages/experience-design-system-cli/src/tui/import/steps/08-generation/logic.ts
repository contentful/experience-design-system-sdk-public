import type { GenerateComponentsProgress } from '@contentful/experience-design-system-backend-pipeline';
import { truncate, type ActivityItem } from '../../shared/running-step/activity.js';
import { withTimes, type RunningLine } from '../../shared/running-step/logic.js';
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

// A long run must not make the log grow without bound.
const MAX_LOGGED_FAILURES = 10;
const MAX_LOGGED_ERROR = 300;

/**
 * The last progress for the log. The panel's list of every component is left out, since the log says which components
 * failed and why instead, and that is what a person reading it needs.
 */
function lastProgress(progress: GenerationProgress): Record<string, unknown> {
  const { activity, ...rest } = progress;
  const failed = activity.filter((item) => item.state === 'failed');
  return {
    final_progress: rest,
    ...(failed.length > 0
      ? {
          failed_components: failed
            .slice(0, MAX_LOGGED_FAILURES)
            .map((item) => ({ name: item.name, error: truncate(item.error ?? '', MAX_LOGGED_ERROR) })),
        }
      : {}),
  };
}

/** How the stage ended. A failure names the step that failed (save decisions, generate components, map tokens). */
export function generationLogOutputs(
  result: GenerationResult,
  progress: GenerationProgress | undefined,
): { outputs: Record<string, unknown>; status: 'success' | 'error' } {
  const last = progress ? lastProgress(progress) : {};
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
  return { components: null, activity: [], mapTokens: 'idle', mapTokensEligible: null };
}

/**
 * The panel's entries after one more event. Each component has one entry, in the order they began: it is running from
 * when it starts, then done, cached or failed. A component the pipeline starts again for a retry keeps its entry.
 */
export function applyActivityEvent(
  event: GenerateComponentsProgress,
  previous: readonly ActivityItem[],
  now: number,
): ActivityItem[] {
  if (
    event.kind !== 'component:started' &&
    event.kind !== 'component:completed' &&
    event.kind !== 'component:cached' &&
    event.kind !== 'component:failed'
  ) {
    return [...previous];
  }
  const index = previous.findIndex((item) => item.name === event.name);
  const startedAt = previous[index]?.startedAt ?? now;
  const item: ActivityItem =
    event.kind === 'component:started'
      ? {
          name: event.name,
          state: 'running',
          startedAt,
          ...(event.attempt > 1 ? { detail: `attempt ${event.attempt}` } : {}),
        }
      : event.kind === 'component:cached'
        ? { name: event.name, state: 'done', detail: 'cached', startedAt }
        : event.kind === 'component:failed'
          ? { name: event.name, state: 'failed', error: event.error, ms: now - startedAt, startedAt }
          : { name: event.name, state: 'done', ms: now - startedAt, startedAt };
  return index >= 0 ? previous.map((existing, i) => (i === index ? item : existing)) : [...previous, item];
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

/**
 * The components row: a progress bar while they are being generated, then a summary once every one has been tried. A
 * component that fails does not stop the run, which only fails at the end, so failures are shown as they happen.
 */
function componentsRow(components: GenerationProgress['components'], name: string): RunningLine {
  if (!components) return { text: `Starting up ${name}...`, complete: false };
  const { done, total, current, failed } = components;

  if (total > 0 && done >= total) {
    return failed > 0
      ? {
          text: `Generated ${total - failed} of ${total} components, ${failed} failed`,
          complete: false,
          state: 'failed',
        }
      : { text: `Generated ${total} component${total === 1 ? '' : 's'}`, complete: true };
  }
  return {
    text: failed > 0 ? `${current} (${failed} failed so far)` : current,
    complete: false,
    progress: { done, total },
    ...(failed > 0 ? { state: 'warning' as const } : {}),
  };
}

/** `rowMs` is how long each finished row took, by position (see `trackFinished`). */
export function progressRows(
  progress: GenerationProgress,
  agent: string,
  rowMs: ReadonlyArray<number | undefined> = [],
): RunningLine[] {
  const name = capitalize(agent);
  const { components, mapTokens } = progress;
  const rows: RunningLine[] = [componentsRow(components, name)];
  if (mapTokens !== 'idle') {
    rows.push({
      text: mapTokens === 'running' ? `Mapping token restrictions via ${name}...` : 'Token restrictions ready',
      complete: mapTokens === 'complete',
    });
  }
  return withTimes(rows, rowMs);
}
