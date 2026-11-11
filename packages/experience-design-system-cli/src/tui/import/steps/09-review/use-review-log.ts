import { useEffect, useRef } from 'react';
import { startDebugRun, finishDebugRun, setDebugRunProgress } from '@tui/debug-store.js';
import {
  REVIEW_RUN,
  openReviewTrail,
  recordReviewAction,
  reviewFinish,
  reviewLoadFailureLog,
  reviewProgress,
  type ReviewTrail,
} from './review-log.js';
import type { CdfReviewEntry } from './types.js';

type Counts = { accepted: number; rejected: number; unresolved: number };

/**
 * Writes one debug log for a visit to the Review. It starts once the components are loaded, grows in memory as the user
 * edits, and is written when they finalize or leave. The trail is also handed to the logger as it grows, so a crash or
 * Ctrl+C writes what happened so far. Going back to the review later is a new visit and a new log.
 */
export function useReviewLog({
  loading,
  loadError,
  components,
}: {
  loading: boolean;
  loadError: string | null | undefined;
  components: CdfReviewEntry[];
}): { record: (label: string) => void; finish: (counts: Counts) => void } {
  const trail = useRef<ReviewTrail | undefined>(undefined);
  const started = useRef(false);
  // The finish and the crash path describe the components as they are then, not as they were when the hook last ran.
  const latest = useRef(components);
  latest.current = components;

  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    startDebugRun({ ...REVIEW_RUN });
    if (loadError) {
      const { summary, outputs } = reviewLoadFailureLog(loadError);
      void finishDebugRun({ summary, outputs, status: 'error', exitMethod: 'discarded' });
      return;
    }
    trail.current = openReviewTrail(components, Date.now());
    const progress = reviewProgress(trail.current, components, Date.now());
    setDebugRunProgress(progress.outputs, progress.summary);
  }, [loading, loadError, components]);

  useEffect(
    () => () => {
      const open = trail.current;
      trail.current = undefined;
      if (open) void finishDebugRun(reviewFinish(open, latest.current, Date.now(), undefined));
    },
    [],
  );

  return {
    record: (label) => {
      if (!trail.current) return;
      recordReviewAction(trail.current, label);
      const progress = reviewProgress(trail.current, latest.current, Date.now());
      setDebugRunProgress(progress.outputs, progress.summary);
    },
    finish: (counts) => {
      const open = trail.current;
      trail.current = undefined;
      if (open) void finishDebugRun(reviewFinish(open, latest.current, Date.now(), counts));
    },
  };
}
