import type { DatabaseSync } from 'node:sqlite';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  loadCDFComponents,
  loadDTCGTokens,
  openPipelineDb,
} from '@contentful/experience-design-system-backend-pipeline';
import type { HistorySnapshot } from './history.js';
import type { CdfReviewEntry, ReviewComponentStatus, TokenReviewToken } from './types.js';

// Non-React review logic from legacy hooks/useReviewSession.ts. Reads and writes the pipeline database.
export type ReviewSessionLoadResult<TExtra = undefined> = {
  entries: CdfReviewEntry[];
  tokens: TokenReviewToken[];
  error: string | null;
  extra?: TExtra;
};

export type ReviewSessionLoaderOptions<TExtra = undefined> = {
  extractSessionId: string;
  tokenSessionId?: string | null;
  loadExtra?: (db: DatabaseSync, sessionId: string) => TExtra;
  sortEntries: (entries: CdfReviewEntry[], extra: TExtra | undefined) => CdfReviewEntry[];
};

export function loadReviewSessionState<TExtra = undefined>({
  extractSessionId,
  tokenSessionId,
  loadExtra,
  sortEntries,
}: ReviewSessionLoaderOptions<TExtra>): ReviewSessionLoadResult<TExtra> {
  const db = openPipelineDb();
  let cdfComponents: Array<{ key: string; entry: CDFComponentEntry }> = [];
  let tokens: TokenReviewToken[] = [];
  let extra: TExtra | undefined;
  try {
    cdfComponents = loadCDFComponents(db, extractSessionId);
    tokens = loadDTCGTokens(db, tokenSessionId ?? extractSessionId).tokens.map((token) => ({
      path: token.path,
      kind: token.$type,
    }));
    extra = loadExtra?.(db, extractSessionId);
  } finally {
    db.close();
  }

  if (cdfComponents.length === 0) {
    return {
      entries: [],
      tokens: [],
      error: 'No generated definitions found for this session. Try re-running generate.',
      extra,
    };
  }

  const entries = cdfComponents.map(({ key, entry }) => ({
    key,
    entry,
    status: 'needs-review' as const,
  }));

  return {
    entries: sortEntries(entries, extra),
    tokens,
    error: null,
    extra,
  };
}

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
    })),
    autoRejected: [...(options.autoRejected ?? [])],
    undoSnapshot:
      options.undoSnapshot === null || options.undoSnapshot === undefined ? null : new Map(options.undoSnapshot),
  };
}

export type ReviewFinalizeCounts = {
  accepted: number;
  rejected: number;
  unresolved: number;
};

export function finalizeReviewSession(extractSessionId: string, components: CdfReviewEntry[]): ReviewFinalizeCounts {
  const accepted = components.filter((component) => component.status === 'accepted').length;
  const rejectedKeys = components
    .filter((component) => component.status === 'rejected')
    .map((component) => component.key);
  const unresolvedKeys = components
    .filter((component) => component.status === 'needs-review')
    .map((component) => component.key);
  const toReject = [...rejectedKeys, ...unresolvedKeys];

  if (toReject.length > 0) {
    const db = openPipelineDb();
    try {
      const statement = db.prepare(
        `UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ? AND name = ?`,
      );
      db.exec('BEGIN');
      try {
        for (const name of toReject) statement.run(extractSessionId, name);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  }

  return {
    accepted,
    rejected: rejectedKeys.length,
    unresolved: unresolvedKeys.length,
  };
}
