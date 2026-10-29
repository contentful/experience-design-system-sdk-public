import { useEffect, useRef } from 'react';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { flowStepInputs, flowStepOutputs, flowStepRun } from './flow-log.js';
import type { FlowState } from './types.js';

function end(from: FlowState, to: FlowState | undefined): void {
  void finishDebugRun(flowStepOutputs(from, to));
}

/**
 * Writes a debug log for every step of the flow. When the step changes it finishes the log of the step that ended, with
 * where it went next, and starts the next one; leaving the import finishes whichever step was open. One hook covers every
 * screen after the review, so none of them has to log for itself.
 */
export function useFlowLog(state: FlowState): void {
  // The state the open step started in. It is what the step's log is described from when it ends.
  const open = useRef<FlowState | undefined>(undefined);

  useEffect(() => {
    if (open.current?.step === state.step) return;
    if (open.current) end(open.current, state);
    startDebugRun({ ...flowStepRun(state.step), inputs: flowStepInputs(state) });
    open.current = state;
  }, [state]);

  useEffect(
    () => () => {
      if (open.current) end(open.current, undefined);
      open.current = undefined;
    },
    [],
  );
}
