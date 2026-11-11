import { withTimes, type RunningLine } from '../../shared/running-step/logic.js';
import type { GenerationProgress } from './types.js';

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
