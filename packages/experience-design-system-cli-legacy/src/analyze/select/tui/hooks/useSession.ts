import { useEffect, useState } from 'react';
import { loadReviewInput } from '../../parser.js';
import { appendReviewEvent, ensureRefineSession, getRefineSessionPaths, saveReviewState } from '../../persistence.js';
import type { ReviewSessionPaths, ReviewSessionSnapshot } from '../../types.js';
import { openPipelineDb, loadRawComponents } from '../../../../session/db.js';

type UseSessionInput = {
  sessionId: string;
  artifactsRoot: string;
  reviewRoot?: string;
};

type UseSessionResult = {
  session: ReviewSessionSnapshot | null;
  paths: ReviewSessionPaths | null;
  loading: boolean;
  error: string | null;
  saveState: (updatedSession: ReviewSessionSnapshot) => Promise<void>;
  appendEvent: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
};

export function useSession({ sessionId, artifactsRoot, reviewRoot }: UseSessionInput): UseSessionResult {
  const [state, setState] = useState<{
    session: ReviewSessionSnapshot | null;
    paths: ReviewSessionPaths | null;
    loading: boolean;
    error: string | null;
  }>({ session: null, paths: null, loading: true, error: null });

  useEffect(() => {
    async function load() {
      const db = openPipelineDb();
      let rawComponents;
      try {
        rawComponents = loadRawComponents(db, sessionId);
      } finally {
        db.close();
      }

      const initialSnapshot = await loadReviewInput(rawComponents, { reviewRoot });
      const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
      const session = await ensureRefineSession(sessionId, artifactsRoot, initialSnapshot);

      const isResume = session.components.some((c) => c.status !== 'needs-review');
      await appendReviewEvent(paths.eventsPath, {
        type: isResume ? 'session_resumed' : 'session_started',
        payload: { componentCount: session.components.length },
      });

      setState({ session, paths, loading: false, error: null });
    }
    load().catch((err) =>
      setState({
        session: null,
        paths: null,
        loading: false,
        error: String(err),
      }),
    );
  }, []);

  const saveState = async (updatedSession: ReviewSessionSnapshot): Promise<void> => {
    if (!state.paths) return;
    await saveReviewState(state.paths.statePath, updatedSession);
  };

  const appendEvent = async (event: { type: string; payload: Record<string, unknown> }): Promise<void> => {
    if (!state.paths) return;
    await appendReviewEvent(state.paths.eventsPath, event);
  };

  return {
    session: state.session,
    paths: state.paths,
    loading: state.loading,
    error: state.error,
    saveState,
    appendEvent,
  };
}
