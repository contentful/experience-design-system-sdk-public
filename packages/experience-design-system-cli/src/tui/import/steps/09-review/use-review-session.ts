import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  loadComponentRationale,
  loadComponentReviewMetadata,
  openPipelineDb,
  readTokensFromPath,
  type ComponentRationale,
  type ComponentReviewMetadata,
} from '@contentful/experience-design-system-backend-pipeline';
import { createHistoryStack, type HistorySnapshot, type HistoryStack } from './history.js';
import { finalizeReviewSession, type ReviewSessionLoadResult } from './session.js';
import { useReviewFinalizePreview } from './use-finalize-preview.js';
import type { CdfReviewEntry, TokenReviewToken } from './types.js';
import { reviewSourceOwner } from './review-models.js';

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
    const catalog = (await readTokensFromPath({ flag: 'tokens', path: tokensPath })).map((token) => ({
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
    const selected = components[selectedIdx];
    const current = selected ? reviewSourceOwner(components, selected) : undefined;
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
        metadata = loadComponentReviewMetadata(db, extractSessionId, current.key, current.componentId);
      } catch {
        metadata = null;
      }
      try {
        rationale = loadComponentRationale(db, extractSessionId, current.key, current.componentId);
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
