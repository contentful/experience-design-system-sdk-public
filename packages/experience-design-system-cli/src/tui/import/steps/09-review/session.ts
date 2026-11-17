import type { HistorySnapshot } from './history.js';
import type { CdfReviewEntry, ReviewComponentStatus, TokenReviewToken } from './types.js';

export type ReviewSessionLoadResult<TExtra = undefined> = {
  entries: CdfReviewEntry[];
  tokens: TokenReviewToken[];
  error: string | null;
  extra?: TExtra;
};

export function createReviewHistorySnapshot(
  components: CdfReviewEntry[],
  options: {
    autoRejected?: readonly string[];
    undoSnapshot?: ReadonlyMap<string, ReviewComponentStatus> | null;
  } = {},
): HistorySnapshot {
  return {
    components: components.map((component) => ({
      key: component.key,
      entry: component.entry,
      status: component.status,
      ...(component.generationError ? { generationError: component.generationError } : {}),
    })),
    autoRejected: [...(options.autoRejected ?? [])],
    undoSnapshot:
      options.undoSnapshot === null || options.undoSnapshot === undefined ? null : new Map(options.undoSnapshot),
  };
}
