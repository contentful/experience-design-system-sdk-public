// What the activity panel beside a long-running step shows: one entry for each thing the step has worked on, with how it
// went. It is a rolling log, so it keeps the entries a person needs to see and drops the rest.

type ActivityState = 'running' | 'done' | 'failed';

export interface ActivityItem {
  name: string;
  state: ActivityState;
  /** A short note after the name, for example "cached" or "create component". */
  detail?: string;
  /** How long it took, once it has finished. */
  ms?: number;
  /** Why it failed. */
  error?: string;
  /** When it started, so its time can be worked out when it finishes. */
  startedAt?: number;
}

// Below this width the panel goes under the step instead of beside it.
const BESIDE_MIN_COLUMNS = 110;
export const PANEL_COLUMNS = 46;

export function panelLayout(columns: number): 'beside' | 'below' {
  return columns >= BESIDE_MIN_COLUMNS ? 'beside' : 'below';
}

const PRIORITY: Record<ActivityState, number> = { failed: 0, running: 1, done: 2 };

/**
 * The entries that fit. A long run has far more entries than lines, and what a person needs is the failures and what is
 * running now, so those are kept first and the newest finished entries fill what is left. The entries stay in the order
 * they happened. `hidden` is how many were left out.
 */
export function visibleActivity(
  items: readonly ActivityItem[],
  max: number,
): { shown: ActivityItem[]; hidden: number } {
  if (items.length <= max) return { shown: [...items], hidden: 0 };
  const chosen = items
    .map((item, index) => ({ index, priority: PRIORITY[item.state] }))
    .sort((a, b) => a.priority - b.priority || b.index - a.index)
    .slice(0, Math.max(0, max))
    .map(({ index }) => index)
    .sort((a, b) => a - b);
  return { shown: chosen.map((index) => items[index]!), hidden: items.length - chosen.length };
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
