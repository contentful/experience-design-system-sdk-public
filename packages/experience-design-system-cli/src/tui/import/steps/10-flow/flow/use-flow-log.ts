import { useEffect, useRef } from 'react';
import { startDebugRun, finishDebugRun, setDebugRunProgress } from '@tui/debug-store.js';
import {
  FLOW_RUN,
  advance,
  flowContext,
  flowFinish,
  flowProgress,
  isFlowFinished,
  openTrail,
  type FlowTrail,
} from './flow-log.js';
import type { FlowState } from './types.js';

/**
 * Writes one debug log for the flow after the review. The trail grows in memory as the step changes; the log is written
 * when the flow reaches done or an error, goes back to the review, or when the import is left. The trail is also handed to
 * the logger as it grows, so a crash or Ctrl+C writes what happened so far. The review is its own step with its own log.
 */
export function useFlowLog(state: FlowState): void {
  // The run that is open, if any, and the state before this one.
  const trail = useRef<FlowTrail | undefined>(undefined);
  const previous = useRef<FlowState | undefined>(undefined);

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    const moved = before !== undefined && before.step !== state.step;
    const now = Date.now();

    let open = trail.current;
    if (!open) {
      // A run starts when the flow leaves the review, and not again for updates inside a step that already ended it.
      if (state.step === 'final-review' || (before && !moved)) return;
      // Only the steps that do work add to the trail, and those always happen inside a run, so the step before the first
      // one has nothing to record.
      open = openTrail(state, now);
      startDebugRun({ ...FLOW_RUN, inputs: flowContext(state) });
    } else if (before && moved) {
      open = advance(open, before, state, now);
    } else {
      return;
    }

    if (isFlowFinished(state.step)) {
      trail.current = undefined;
      void finishDebugRun(flowFinish(open, state, now));
      return;
    }
    trail.current = open;
    setDebugRunProgress(flowProgress(open, now));
  }, [state]);

  useEffect(
    () => () => {
      const open = trail.current;
      trail.current = undefined;
      if (open) void finishDebugRun(flowFinish(open, undefined, Date.now()));
    },
    [],
  );
}
