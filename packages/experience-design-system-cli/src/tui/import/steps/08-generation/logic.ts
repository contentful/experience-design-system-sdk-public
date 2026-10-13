import type { GenerationProgress } from './types.js';

// Ported from legacy `wizard-generate-progress.ts` and the small parsing functions in `WizardApp.tsx`, with their tests.

export function initialProgress(): GenerationProgress {
  return { components: null, mapTokens: 'idle', mapTokensEligible: null };
}

const PROGRESS_LINE = /^progress=generate:(\d+)\/(\d+):(.+)$/;
const STARTED_LINE = /\[(\d+)\/(\d+)\]\s+(.+)/;

/**
 * Folds a chunk of `__generate components` stderr into the progress. Two line shapes carry it:
 *  1. `progress=generate:<done>/<total>:<name>`, emitted when a component finishes. `done` is the count of finished
 *     components and never goes down.
 *  2. `[<index>/<total>] <name>`, emitted when a component starts (and again on a retry). With more than one worker its
 *     index is the worker's starting position, not a count of completions, so it must only change `current`.
 */
export function applyGenerateStderr(
  chunk: string,
  previous: GenerationProgress['components'],
): GenerationProgress['components'] {
  let state = previous;
  for (const line of chunk.split('\n')) {
    const finished = PROGRESS_LINE.exec(line);
    if (finished) {
      state = { done: Number(finished[1]), total: Number(finished[2]), current: finished[3]!.trim() };
      continue;
    }
    const started = STARTED_LINE.exec(line);
    if (started) {
      state = { done: state?.done ?? 0, total: Number(started[2]), current: started[3]!.trim() };
    }
  }
  return state;
}

/** The session, the component count and the renamed-slot count from the command's output. */
export function parseGenerateResult(
  output: { stdout: string; stderr: string },
  fallbackCount: number,
): { generateSessionId: string | null; generatedCount: number; renamedSlotsCount: number } {
  const session = /^session=(.+)$/m.exec(output.stdout);
  const count = /(\d+) components?/.exec(output.stderr);
  const renamed = /^renamed-slots:\s*(\d+)$/m.exec(output.stdout);
  return {
    generateSessionId: session ? session[1]!.trim() : null,
    generatedCount: count ? Number(count[1]) : fallbackCount,
    renamedSlotsCount: renamed ? Number(renamed[1]) : 0,
  };
}

/** Token mapping runs only when there is something to map and tokens to map it from. */
export function shouldRunMapTokens(counts: { mappablePropCount: number; rawTokenCount: number }): boolean {
  return counts.mappablePropCount > 0 && counts.rawTokenCount > 0;
}

/** "5 components accepted." or, with some left out, "5 components accepted, 2 excluded due to validation errors." */
export function formatAcceptanceSummary(counts: { accepted: number; autoRejected: number }): string {
  const accepted = `${counts.accepted} component${counts.accepted === 1 ? '' : 's'} accepted`;
  if (counts.autoRejected === 0) return `${accepted}.`;
  return `${accepted}, ${counts.autoRejected} excluded due to validation errors.`;
}

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** The screen's description: what was accepted, what is happening to it, and whether the tokens are used. */
export function describeGeneration(input: { acceptedCount: number; agent: string; hasTokens: boolean }): string {
  const agent = capitalize(input.agent);
  return (
    `${formatAcceptanceSummary({ accepted: input.acceptedCount, autoRejected: 0 })}\n` +
    `${agent} is mapping your selected components to Contentful's Component Definition Format (CDF).` +
    `${input.hasTokens ? ' Using your design tokens for prop resolution.' : ''}`
  );
}

/** The rows the generating screen shows for this progress. */
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
