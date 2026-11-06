import { useEffect, useRef, useState } from 'react';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { trackFinished } from '../../shared/running-step/logic.js';
import { generationLogInputs, generationLogOutputs, initialProgress, progressRows } from './logic.js';
import { runGeneration } from './run.js';
import type { GenerationInput, GenerationProgress, GenerationResult } from './types.js';

export type GenerationState =
  | { status: 'running'; progress: GenerationProgress; rowMs: Array<number | undefined> }
  | { status: 'done'; result: GenerationResult };

/**
 * Runs the generation stage once for the given input and reports its progress. Passing a different input starts a new
 * run; passing nothing leaves the stage idle. A run that finishes after the input changed or the screen went away is
 * ignored.
 */
export function useGeneration(input: GenerationInput | undefined): GenerationState | undefined {
  const [state, setState] = useState<GenerationState>();
  const current = useRef<GenerationInput>();

  useEffect(() => {
    current.current = input;
    if (!input) {
      setState(undefined);
      return;
    }
    setState({ status: 'running', progress: initialProgress(), rowMs: [] });
    // The log is written when the run ends, with the last progress, so a failure shows how far it got.
    let lastProgress: GenerationProgress | undefined;
    // How long each row took, noted the first time it is seen finished.
    const startedAt = Date.now();
    let rowMs: Array<number | undefined> = [];
    startDebugRun({
      flow: 'import/generation',
      step: '08-generation',
      menuOption: 'Generation',
      inputs: generationLogInputs(input),
    });
    void runGeneration(input, (progress) => {
      lastProgress = progress;
      rowMs = trackFinished(rowMs, progressRows(progress, input.agent), Date.now() - startedAt);
      if (current.current === input) setState({ status: 'running', progress, rowMs });
    }).then((result) => {
      if (current.current !== input) return;
      void finishDebugRun({
        ...generationLogOutputs(result, lastProgress),
        exitMethod: result.ok ? 'saved' : 'discarded',
      });
      setState({ status: 'done', result });
    });
    return () => {
      if (current.current === input) current.current = undefined;
    };
  }, [input]);

  return state;
}
