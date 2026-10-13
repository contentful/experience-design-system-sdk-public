import { useEffect, useRef, useState } from 'react';
import { initialProgress } from './logic.js';
import { runGeneration } from './run.js';
import type { GenerationInput, GenerationProgress, GenerationResult } from './types.js';

export type GenerationState =
  | { status: 'running'; progress: GenerationProgress }
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
    setState({ status: 'running', progress: initialProgress() });
    void runGeneration(input, (progress) => {
      if (current.current === input) setState({ status: 'running', progress });
    }).then((result) => {
      if (current.current === input) setState({ status: 'done', result });
    });
    return () => {
      if (current.current === input) current.current = undefined;
    };
  }, [input]);

  return state;
}
