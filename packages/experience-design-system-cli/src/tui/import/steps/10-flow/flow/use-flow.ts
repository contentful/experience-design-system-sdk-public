import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  createFlowController,
  realFlowDeps,
  startWizardLog,
  type FlowController,
  type FlowDeps,
  type FlowStart,
} from './controller.js';

/**
 * The flow for a start, once. `start` is undefined until the generation stage has finished, so the hook can be called
 * unconditionally; the step log is started with the controller, as the wizard started it with its first render.
 */
export function useFlow(
  start: FlowStart | undefined,
  deps: () => FlowDeps = realFlowDeps,
): { controller: FlowController; state: ReturnType<FlowController['getState']> } | undefined {
  const controller = useRef<FlowController>();
  if (start && !controller.current) {
    try {
      startWizardLog();
    } catch {
      // A step log that cannot be started must never stop the import.
    }
    controller.current = createFlowController(start, deps());
  }
  const current = controller.current;
  const state = useSyncExternalStore(
    (listener) => current?.subscribe(listener) ?? (() => undefined),
    () => current?.getState(),
  );

  useEffect(() => {
    if (!start) controller.current = undefined;
  }, [start]);

  return current && state ? { controller: current, state } : undefined;
}
