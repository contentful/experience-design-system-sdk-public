import { useEffect, useRef, useState } from 'react';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { byAiSuggestion } from '../../shared/component-facts.js';
import { noteJourney } from '../../shared/import-ledger.js';
import { rowTimer } from '../../shared/running-step/logic.js';
import { loadScopeGate } from '../07-scope-gate/load.js';
import type { ScopeComponent } from '../07-scope-gate/types.js';
import { extractionLog } from './log.js';
import { initialProgress, progressRows } from './logic.js';
import { runExtraction } from './run.js';
import type { ExtractionInput, ExtractionProgress, ExtractionResult } from './types.js';

export type ExtractionState =
  | { status: 'running'; progress: ExtractionProgress; rowMs: Array<number | undefined> }
  | { status: 'done'; result: ExtractionResult };

/** The components the extraction left in the session, for the log. Empty when it failed or they cannot be read. */
function readComponents(result: ExtractionResult): ScopeComponent[] {
  if (!result.ok) return [];
  const loaded = loadScopeGate(result.extraction.sessionId);
  return loaded.ok ? loaded.components : [];
}

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
      rowMs: [],
    });
    // The log is written when the run ends, with the last progress, so a failed job shows which one it was.
    let lastProgress: ExtractionProgress | undefined;
    // How long each job took, noted the first time it is seen finished.
    const timeRows = rowTimer();
    startDebugRun({ flow: 'import/extraction', step: '06-extraction', menuOption: 'Extraction' });
    void runExtraction(input, (progress) => {
      lastProgress = progress;
      const rowMs = timeRows(progressRows(progress, input.agent));
      if (current.current === input) setState({ status: 'running', progress, rowMs });
    }).then((result) => {
      if (current.current !== input) return;
      const rowMs = lastProgress ? timeRows(progressRows(lastProgress, input.agent)) : [];
      const components = readComponents(result);
      const suggested = byAiSuggestion(components);
      noteJourney(suggested.accepted, { ai: 'accepted' });
      noteJourney(suggested.rejected, { ai: 'rejected' });
      noteJourney(suggested.none, { ai: 'no suggestion' });
      const { summary, data, status } = extractionLog({
        input,
        result,
        rows: lastProgress ? progressRows(lastProgress, input.agent, rowMs) : [],
        components,
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
