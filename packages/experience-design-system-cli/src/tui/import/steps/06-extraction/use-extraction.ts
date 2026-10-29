import { useEffect, useRef, useState } from 'react';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { extractionLogInputs, extractionLogOutputs, initialProgress } from './logic.js';
import { runExtraction } from './run.js';
import type { ExtractionInput, ExtractionProgress, ExtractionResult } from './types.js';

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
  const current = useRef<ExtractionInput>();

  useEffect(() => {
    current.current = input;
    if (!input) {
      setState(undefined);
      return;
    }
    setState({
      status: 'running',
      progress: initialProgress({
        hasCredentials: input.credentials !== null,
        hasRawTokens: input.rawTokensPath !== '',
      }),
    });
    // The log is written when the run ends, with the last progress, so a failed job shows which one it was.
    let lastProgress: ExtractionProgress | undefined;
    startDebugRun({
      flow: 'import/extraction',
      step: '06-extraction',
      menuOption: 'Extraction',
      inputs: extractionLogInputs(input),
    });
    void runExtraction(input, (progress) => {
      lastProgress = progress;
      if (current.current === input) setState({ status: 'running', progress });
    }).then((result) => {
      if (current.current !== input) return;
      void finishDebugRun({
        ...extractionLogOutputs(result, lastProgress, input.credentials?.cmaToken ?? ''),
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
