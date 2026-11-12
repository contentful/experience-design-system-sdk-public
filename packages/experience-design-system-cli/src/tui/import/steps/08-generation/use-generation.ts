import { useEffect, useRef, useState } from 'react';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { noteJourney } from '../../shared/import-ledger.js';
import { rowTimer } from '../../shared/running-step/logic.js';
import { generationLog } from './log.js';
import { initialProgress, progressRows } from './logic.js';
import { runGeneration } from './run.js';
import type { GenerationDetails, GenerationInput, GenerationProgress, GenerationResult } from './types.js';

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
    const timeRows = rowTimer();
    // Which components were generated, restored from the cache or failed, told by the run once the agent has finished.
    let details: GenerationDetails | undefined;
    startDebugRun({ flow: 'import/generation', step: '08-generation', menuOption: 'Generation' });
    void runGeneration({ ...input, onDetails: (told) => (details = told) }, (progress) => {
      lastProgress = progress;
      const rowMs = timeRows(progressRows(progress, input.agent));
      if (current.current === input) setState({ status: 'running', progress, rowMs });
    }).then((result) => {
      if (current.current !== input) return;
      const rowMs = lastProgress ? timeRows(progressRows(lastProgress, input.agent)) : [];
      if (details) {
        noteJourney(details.generated, { generation: 'generated' });
        noteJourney(details.fromCache, { generation: 'restored from cache' });
        noteJourney(details.failed, { generation: 'failed' });
      }
      const { summary, data, status } = generationLog({
        input,
        result,
        rows: lastProgress ? progressRows(lastProgress, input.agent, rowMs) : [],
        details,
      });
      void finishDebugRun({ summary, outputs: data, status, exitMethod: result.ok ? 'saved' : 'discarded' });
      setState({ status: 'done', result });
    });
    return () => {
      if (current.current === input) current.current = undefined;
    };
  }, [input]);

  return state;
}
