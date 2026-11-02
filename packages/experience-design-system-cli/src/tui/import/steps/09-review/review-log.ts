import type { CdfReviewEntry, ReviewComponentStatus } from './types.js';

// What the debug log says about the Review. The step is interactive, so the log records what the user decided, not every
// keypress: how each component ended up compared with how it arrived, the kinds of edit that were made, and how the step
// ended. Only component keys and counts are stored.

export const REVIEW_RUN = { flow: 'import/review', step: '09-review', menuOption: 'Review' } as const;

// A long session must not make the log grow without bound.
const MAX_ACTIONS = 30;
const MAX_NAMES = 20;

export type ReviewTrail = {
  startedAt: number;
  /** How each component arrived, by key. */
  start: Map<string, ReviewComponentStatus>;
  /** The edits in order, as the history labels them (for example `edit-save` or `token-review:size`). */
  actions: string[];
  /** The same edits counted by kind, so a long session still reads at a glance. */
  kinds: Record<string, number>;
};

const countStatuses = (components: CdfReviewEntry[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const { status } of components) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
};

const capped = (keys: string[]): { count: number; keys: string[] } => ({
  count: keys.length,
  keys: keys.slice(0, MAX_NAMES),
});

/** What the review starts with: how many components, and how the AI and the checks left them. */
export function reviewInputs(components: CdfReviewEntry[]): Record<string, unknown> {
  return { components: components.length, by_status: countStatuses(components) };
}

export function openReviewTrail(components: CdfReviewEntry[], now: number): ReviewTrail {
  return {
    startedAt: now,
    start: new Map(components.map((component) => [component.key, component.status])),
    actions: [],
    kinds: {},
  };
}

export function recordReviewAction(trail: ReviewTrail, label: string): void {
  const kind = label.split(':')[0] ?? label;
  trail.kinds[kind] = (trail.kinds[kind] ?? 0) + 1;
  if (trail.actions.length < MAX_ACTIONS) trail.actions.push(label);
}

function render(
  trail: ReviewTrail,
  components: CdfReviewEntry[],
  now: number,
  outcome: string,
): Record<string, unknown> {
  // The decisions that matter: where a component ended up accepted or rejected after arriving as something else.
  const acceptedByUser: string[] = [];
  const rejectedByUser: string[] = [];
  for (const { key, status } of components) {
    const was = trail.start.get(key);
    if (was === status) continue;
    if (status === 'accepted') acceptedByUser.push(key);
    if (status === 'rejected') rejectedByUser.push(key);
  }
  const total = Object.values(trail.kinds).reduce((sum, count) => sum + count, 0);
  return {
    outcome,
    seconds: Math.round((now - trail.startedAt) / 100) / 10,
    edits: { total, by_kind: trail.kinds, in_order: trail.actions },
    now: countStatuses(components),
    accepted_by_user: capped(acceptedByUser),
    rejected_by_user: capped(rejectedByUser),
  };
}

/** What a crash or Ctrl+C writes if it cuts the review short. */
export function reviewProgress(trail: ReviewTrail, components: CdfReviewEntry[], now: number): Record<string, unknown> {
  return render(trail, components, now, 'interrupted');
}

/** How the review ended. `final` is the count the user confirmed, or undefined when the review was left without finishing. */
export function reviewFinish(
  trail: ReviewTrail,
  components: CdfReviewEntry[],
  now: number,
  final: { accepted: number; rejected: number; unresolved: number } | undefined,
): { outputs: Record<string, unknown>; status: 'success'; exitMethod: 'saved' | 'discarded' } {
  const outcome = final
    ? `finalized: ${final.accepted} accepted, ${final.rejected} rejected, ${final.unresolved} unresolved`
    : 'left the review without finishing';
  return {
    outputs: render(trail, components, now, outcome),
    status: 'success',
    exitMethod: final ? 'saved' : 'discarded',
  };
}
