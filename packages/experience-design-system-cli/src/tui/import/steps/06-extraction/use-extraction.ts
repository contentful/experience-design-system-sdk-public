import { useEffect, useRef, useState } from 'react';
import { initialProgress } from './logic.js';
import { runExtraction } from './run.js';
import type { ExtractionInput, ExtractionProgress, ExtractionResult } from './types.js';
import { isAbortError, linkAbortSignal, trackImportWork } from '../../cancellation.js';

export type ExtractionState =
  | { status: 'running'; progress: ExtractionProgress }
  | { status: 'done'; result: ExtractionResult };

/**
 * Runs the extraction stage once for the given input and reports its progress. Passing a different input starts a new
 * run; passing nothing leaves the stage idle. A run that finishes after the input changed or the screen went away is
 * ignored.
 */
export function useExtraction(input: ExtractionInput | undefined): ExtractionState | undefined {
  const [state, setState] = useState<ExtractionState>();
  const current = useRef<{ input: ExtractionInput; controller: AbortController }>();

  useEffect(() => {
    if (!input) {
      current.current = undefined;
      setState(undefined);
      return;
    }
    const linked = linkAbortSignal(input.signal);
    const run = { input, controller: linked.controller };
    current.current = run;
    const isCurrent = (): boolean => current.current === run && !run.controller.signal.aborted;
    setState({
      status: 'running',
      progress: initialProgress({
        hasCredentials: input.credentials !== null,
        hasRawTokens: input.rawTokensPath !== '',
      }),
    });
    const work = trackImportWork(
      runExtraction({ ...input, signal: run.controller.signal }, (progress) => {
        if (isCurrent()) setState({ status: 'running', progress });
      }),
    );
    void work
      .then((result) => {
        if (isCurrent()) setState({ status: 'done', result });
      })
      .catch((error: unknown) => {
        if (!isCurrent() || isAbortError(error)) return;
        setState({
          status: 'done',
          result: {
            ok: false,
            step: 'analyze extract',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      })
      .finally(linked.dispose);
    return () => {
      if (current.current === run) current.current = undefined;
      run.controller.abort();
      linked.dispose();
    };
  }, [input]);

  return state;
}
