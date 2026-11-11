import { DATA_NAMES, SUMMARY_NAMES } from './entity-lists.js';

// What happened to each component on its way through the import, kept in memory while the import runs so the last log can
// tell the whole story of a component in one line. Each step notes what it knows about the components it handled; the
// Publish log reads it. Nothing is written to disk here, and nothing here is needed for the import to work.
//
// Components are matched by name, ignoring case, because the pipeline can line a local name up with an existing component
// whose ID differs only in case. A component whose ID differs in more than case shows up as two lines.

export type Journey = {
  /** What the selection agent suggested at extraction. */
  ai?: 'accepted' | 'rejected' | 'no suggestion';
  /** What the user decided at the scope gate. */
  decision?: 'accepted' | 'left out';
  generation?: 'generated' | 'restored from cache' | 'failed';
  /** The status the component had when the review ended. */
  review?: string;
  /** What the preview said would happen. `unchanged` means it already exists in Contentful and is identical. */
  preview?: 'new' | 'changed' | 'unchanged' | 'removed';
  /** What the push did. */
  push?: 'created' | 'updated' | 'removed' | 'failed';
};

const journeys = new Map<string, { name: string; journey: Journey }>();

/** Starts a new import, so the earlier one's components stop showing up. */
export function resetImportLedger(): void {
  journeys.clear();
}

/** Adds what a step knows about these components to what the earlier steps noted. */
export function noteJourney(names: Iterable<string>, patch: Journey): void {
  for (const name of names) {
    const key = name.toLowerCase();
    const entry = journeys.get(key) ?? { name, journey: {} };
    entry.journey = { ...entry.journey, ...patch };
    journeys.set(key, entry);
  }
}

/** The journey as one line: only the steps that said something, in the order they happen. */
function journeyText(journey: Journey): string {
  const parts: string[] = [];
  if (journey.ai) parts.push(`AI: ${journey.ai}`);
  if (journey.decision) parts.push(`you: ${journey.decision}`);
  if (journey.generation) parts.push(journey.generation);
  if (journey.review) parts.push(`review: ${journey.review}`);
  if (journey.preview) parts.push(`preview: ${journey.preview}`);
  if (journey.push) parts.push(`push: ${journey.push}`);
  return parts.join(' → ');
}

/**
 * Whether the component ended up somewhere other than pushed: left out, rejected, failed, unchanged, or accepted and never
 * pushed. These are the ones a person is looking for when a component "goes missing", so they are listed first.
 */
function needsAttention(journey: Journey): boolean {
  return (
    journey.decision === 'left out' ||
    journey.generation === 'failed' ||
    journey.review === 'rejected' ||
    journey.preview === 'unchanged' ||
    journey.push === 'failed' ||
    (journey.decision === 'accepted' && journey.push === undefined)
  );
}

/** The log's two sections for the whole import: `lines` for the Summary, `data` for AI. Undefined when nothing was noted. */
export function importJourneys(): { lines: string[]; data: Record<string, unknown> } | undefined {
  if (journeys.size === 0) return undefined;
  const all = [...journeys.values()].sort(
    (a, b) => Number(needsAttention(b.journey)) - Number(needsAttention(a.journey)) || a.name.localeCompare(b.name),
  );
  const attention = all.filter((entry) => needsAttention(entry.journey)).length;

  return {
    lines: [
      `What happened to each component: ${all.length} (${attention} did not simply get pushed, listed first)`,
      ...all.slice(0, SUMMARY_NAMES).map((entry) => `  ${entry.name}: ${journeyText(entry.journey)}`),
      ...(all.length > SUMMARY_NAMES ? [`  …and ${all.length - SUMMARY_NAMES} more`] : []),
    ],
    data: {
      count: all.length,
      not_simply_pushed: attention,
      components: all.slice(0, DATA_NAMES).map((entry) => ({ name: entry.name, ...entry.journey })),
      ...(all.length > DATA_NAMES ? { truncated: true } : {}),
    },
  };
}
