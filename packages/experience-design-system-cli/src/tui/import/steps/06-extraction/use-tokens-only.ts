import { useEffect, useRef, useState } from 'react';
import { runTokensOnly, type TokensOnlyInput, type TokensOnlyResult } from './run-tokens-only.js';
import { isAbortError, linkAbortSignal, trackImportWork } from '../../cancellation.js';

export type TokensOnlyState = { status: 'running' } | { status: 'done'; result: TokensOnlyResult };

/**
 * Runs the tokens-only stage once for the given input. Passing nothing leaves it idle. A run that finishes after the
 * input changed or the screen went away is ignored.
 */
export function useTokensOnly(input: TokensOnlyInput | undefined): TokensOnlyState | undefined {
  const [state, setState] = useState<TokensOnlyState>();
  const current = useRef<{ input: TokensOnlyInput; controller: AbortController }>();

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
    setState({ status: 'running' });
    void trackImportWork(runTokensOnly({ ...input, signal: run.controller.signal }))
      .then((result) => {
        if (isCurrent()) setState({ status: 'done', result });
      })
      .catch((error: unknown) => {
        if (!isCurrent() || isAbortError(error)) return;
        setState({
          status: 'done',
          result: {
            ok: false,
            step: 'generate tokens',
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
