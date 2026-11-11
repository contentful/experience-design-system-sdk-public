import { nameLines, nameList } from '../../shared/entity-lists.js';
import type { CdfReviewEntry, ReviewComponentStatus } from './types.js';

// What the debug log says about the Review. The step is interactive, so the log records what the user decided, not every
// keypress: how each component ended up compared with how it arrived, the kinds of edit that were made, and how the step
// ended. Components are listed by key; the lists are cut (see `entity-lists`) and the counts are always the full counts.

export const REVIEW_RUN = { flow: 'import/review', step: '09-review', menuOption: 'Review' } as const;

// A long session must not make the log grow without bound.
const MAX_ACTIONS = 30;

export type ReviewTrail = {
  startedAt: number;
  /** How each component arrived, by key. */
  start: Map<string, ReviewComponentStatus>;
  /** The edits in order, as the history labels them (for example `edit-save` or `token-review:size`). */
  actions: string[];
  /** The same edits counted by kind, so a long session still reads at a glance. */
  kinds: Record<string, number>;
};

/** What a log section carries: `summary` for a person, `outputs` for AI, both with the same facts. */
type ReviewLog = { summary: string[]; outputs: Record<string, unknown> };

const countStatuses = (statuses: Iterable<ReviewComponentStatus>): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
};

const countsText = (counts: Record<string, number>): string =>
  Object.entries(counts)
    .map(([name, count]) => `${count} ${name}`)
    .join(', ') || 'none';

export function openReviewTrail(components: CdfReviewEntry[], now: number): ReviewTrail {
  return {
    startedAt: now,
    start: new Map(components.map((component) => [component.key, component.status])),
    actions: [],
    kinds: {},
  };
}

export function recordReviewAction(trail: ReviewTrail, label: string): void {
  const kind = label.split(':')[0];
  trail.kinds[kind] = (trail.kinds[kind] ?? 0) + 1;
  if (trail.actions.length < MAX_ACTIONS) trail.actions.push(label);
}

function render(trail: ReviewTrail, components: CdfReviewEntry[], now: number, outcome: string): ReviewLog {
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
  const seconds = Math.round((now - trail.startedAt) / 100) / 10;
  const arrived = countStatuses(trail.start.values());
  const ended = countStatuses(components.map((component) => component.status));
  const accepted = nameList(acceptedByUser);
  const rejected = nameList(rejectedByUser);
  // Where every component ended up, by name, so a component can be found by the status it finished in.
  const finalByStatus: Record<string, string[]> = {};
  for (const { key, status } of components) (finalByStatus[status] ??= []).push(key);
  const finalLists = Object.fromEntries(
    Object.entries(finalByStatus).map(([status, keys]) => [status, nameList(keys)]),
  );

  return {
    summary: [
      `Components: ${components.length}`,
      `Arrived as: ${countsText(arrived)}`,
      `Ended as: ${countsText(ended)}`,
      ...Object.entries(finalLists).flatMap(([status, list]) => nameLines(`Finished ${status}`, list)),
      `Time in the review: ${seconds}s`,
      `Edits: ${total}${total > 0 ? ` (${countsText(trail.kinds)})` : ''}`,
      ...nameLines('Accepted by you (they arrived as something else)', accepted),
      ...nameLines('Rejected by you (they arrived as something else)', rejected),
      `Outcome: ${outcome}`,
    ],
    outputs: {
      outcome,
      seconds,
      arrived,
      edits: { total, by_kind: trail.kinds, in_order: trail.actions },
      now: ended,
      finished_as: finalLists,
      accepted_by_user: accepted,
      rejected_by_user: rejected,
    },
  };
}

/** What a crash or Ctrl+C writes if it cuts the review short. */
export function reviewProgress(trail: ReviewTrail, components: CdfReviewEntry[], now: number): ReviewLog {
  return render(trail, components, now, 'interrupted');
}

/** How the review ended. `final` is the count the user confirmed, or undefined when the review was left without finishing. */
export function reviewFinish(
  trail: ReviewTrail,
  components: CdfReviewEntry[],
  now: number,
  final: { accepted: number; rejected: number; unresolved: number } | undefined,
): ReviewLog & { status: 'success'; exitMethod: 'saved' | 'discarded' } {
  const outcome = final
    ? `finalized: ${final.accepted} accepted, ${final.rejected} rejected, ${final.unresolved} unresolved`
    : 'left the review without finishing';
  return {
    ...render(trail, components, now, outcome),
    status: 'success',
    exitMethod: final ? 'saved' : 'discarded',
  };
}

/** The log for a review that never opened, because the components could not be read. */
export function reviewLoadFailureLog(error: string): ReviewLog {
  return {
    summary: [`Could not read the components: ${error}`],
    outputs: { outcome: 'could not load the components', error },
  };
}
