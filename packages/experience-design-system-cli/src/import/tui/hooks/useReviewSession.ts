import type { DatabaseSync } from 'node:sqlite';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { readTokensFromPath } from '../../../apply/tokens.js';
import {
  loadCDFComponents,
  loadComponentRationale,
  loadComponentReviewMetadata,
  loadDTCGTokens,
  openPipelineDb,
  type ComponentRationale,
  type ComponentReviewMetadata,
} from '../../../session/db.js';
import { type TokenReviewToken } from '../../../analyze/select/tui/components/TokenReviewPanel.js';
import type { ReviewComponentStatus } from '../../../analyze/select/types.js';
import { createHistoryStack, type HistorySnapshot, type HistoryStack } from '../history.js';
import { useReviewFinalizePreview } from '../useFinalizePreview.js';

export type CdfReviewEntry = {
  key: string;
  entry: CDFComponentEntry;
  status: ReviewComponentStatus;
};

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

type UseReviewSessionOptions<TExtra> = {
  loadSession: () => ReviewSessionLoadResult<TExtra>;
  tokensPath?: string;
  onExtraLoaded?: (extra: TExtra | undefined) => void;
};

type UseReviewSessionResult<TExtra> = {
  components: CdfReviewEntry[];
  setComponents: Dispatch<SetStateAction<CdfReviewEntry[]>>;
  loading: boolean;
  loadError: string | null;
  availableTokens: TokenReviewToken[];
  reloadFromSave: () => ReviewSessionLoadResult<TExtra> | null;
};

export function useReviewSession<TExtra = undefined>({
  loadSession,
  tokensPath,
  onExtraLoaded,
}: UseReviewSessionOptions<TExtra>): UseReviewSessionResult<TExtra> {
  const [components, setComponents] = useState<CdfReviewEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableTokens, setAvailableTokens] = useState<TokenReviewToken[]>([]);

  const loadInitialState = useCallback(async () => {
    const result = loadSession();
    if (result.error || !tokensPath) return { result, catalog: result.tokens };
    const catalog = (await readTokensFromPath('tokens', tokensPath)).map((token) => ({
      path: token.path,
      kind: token.$type,
    }));
    return { result, catalog };
  }, [loadSession, tokensPath]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const { result, catalog } = await loadInitialState();
        if (disposed) return;
        if (result.error) {
          setLoadError(result.error);
          return;
        }
        setLoadError(null);
        setComponents(result.entries);
        setAvailableTokens(catalog);
        onExtraLoaded?.(result.extra);
      } catch (error: unknown) {
        if (!disposed) setLoadError(String(error));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [loadInitialState, onExtraLoaded]);

  const reloadFromSave = (): ReviewSessionLoadResult<TExtra> | null => {
    try {
      const result = loadSession();
      if (result.error) {
        setLoadError(result.error);
        return null;
      }
      setLoadError(null);
      setComponents(result.entries);
      setAvailableTokens(result.tokens);
      onExtraLoaded?.(result.extra);
      return result;
    } catch (error: unknown) {
      setLoadError(String(error));
      return null;
    }
  };

  return {
    components,
    setComponents,
    loading,
    loadError,
    availableTokens,
    reloadFromSave,
  };
}

type UseReviewMetadataOptions = {
  components: CdfReviewEntry[];
  selectedIdx: number;
  extractSessionId: string;
};

export function useReviewMetadata({ components, selectedIdx, extractSessionId }: UseReviewMetadataOptions): {
  reviewMetadata: ComponentReviewMetadata | null;
  componentRationale: ComponentRationale | null;
} {
  const [reviewMetadata, setReviewMetadata] = useState<ComponentReviewMetadata | null>(null);
  const [componentRationale, setComponentRationale] = useState<ComponentRationale | null>(null);

  useEffect(() => {
    const current = components[selectedIdx];
    if (!current) {
      setReviewMetadata(null);
      setComponentRationale(null);
      return;
    }

    let metadata: ComponentReviewMetadata | null = null;
    let rationale: ComponentRationale | null = null;
    const db = openPipelineDb();
    try {
      try {
        metadata = loadComponentReviewMetadata(db, extractSessionId, current.key);
      } catch {
        metadata = null;
      }
      try {
        rationale = loadComponentRationale(db, extractSessionId, current.key);
      } catch {
        rationale = null;
      }
    } finally {
      db.close();
    }
    setReviewMetadata(metadata);
    setComponentRationale(rationale);
  }, [components, extractSessionId, selectedIdx]);

  return { reviewMetadata, componentRationale };
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

type UseReviewHistoryOptions = {
  loading: boolean;
  components: CdfReviewEntry[];
  createSnapshot: (components: CdfReviewEntry[]) => HistorySnapshot;
  applySnapshot: (snapshot: HistorySnapshot) => void;
};

export function useReviewHistory({ loading, components, createSnapshot, applySnapshot }: UseReviewHistoryOptions): {
  historySeededRef: { current: boolean };
  pushHistorySnapshot: (entries: CdfReviewEntry[], label: string) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  resetHistory: (snapshot: HistorySnapshot) => void;
} {
  const historyRef = useRef<HistoryStack | null>(null);
  const historySeededRef = useRef(false);

  useEffect(() => {
    if (loading || historySeededRef.current) return;
    historySeededRef.current = true;
    historyRef.current = createHistoryStack(createSnapshot(components));
  }, [components, createSnapshot, loading]);

  const pushHistorySnapshot = (entries: CdfReviewEntry[], label: string): void => {
    if (!historyRef.current) return;
    historyRef.current.push(createSnapshot(entries), label);
  };

  const handleUndo = (): void => {
    const snapshot = historyRef.current?.undo();
    if (snapshot) applySnapshot(snapshot);
  };

  const handleRedo = (): void => {
    const snapshot = historyRef.current?.redo();
    if (snapshot) applySnapshot(snapshot);
  };

  const resetHistory = (snapshot: HistorySnapshot): void => {
    historyRef.current?.reset(snapshot);
  };

  return { historySeededRef, pushHistorySnapshot, handleUndo, handleRedo, resetHistory };
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

export type UseReviewFinalizeOptions = {
  showFinalize: boolean;
  extractSessionId: string;
  tokensPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  components: CdfReviewEntry[];
  onFinalize: (accepted: number, rejected: number, unresolved: number) => void;
};

/**
 * Shared by both the composite and atomic generate-review steps: the Finalize
 * dialog's scoped preview (`useReviewFinalizePreview`) plus the confirm
 * handler that reclassifies rejected/unresolved components and reports the
 * final counts back to the wizard.
 */
export function useReviewFinalize({
  showFinalize,
  extractSessionId,
  tokensPath,
  spaceId,
  environmentId,
  cmaToken,
  host,
  components,
  onFinalize,
}: UseReviewFinalizeOptions) {
  const finalizePreview = useReviewFinalizePreview({
    open: showFinalize,
    extractSessionId,
    tokensPath,
    spaceId,
    environmentId,
    cmaToken,
    host,
    components,
  });

  const handleFinalizeConfirm = () => {
    const counts = finalizeReviewSession(extractSessionId, components);
    onFinalize(counts.accepted, counts.rejected, counts.unresolved);
  };

  return { finalizePreview, handleFinalizeConfirm };
}
