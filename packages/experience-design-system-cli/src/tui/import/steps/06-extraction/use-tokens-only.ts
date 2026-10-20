import { useEffect, useRef, useState } from 'react';
import { runTokensOnly, type TokensOnlyInput, type TokensOnlyResult } from './run-tokens-only.js';

export type TokensOnlyState = { status: 'running' } | { status: 'done'; result: TokensOnlyResult };

/**
 * Runs the tokens-only stage once for the given input. Passing nothing leaves it idle. A run that finishes after the
 * input changed or the screen went away is ignored.
 */
export function useTokensOnly(input: TokensOnlyInput | undefined): TokensOnlyState | undefined {
  const [state, setState] = useState<TokensOnlyState>();
  const current = useRef<TokensOnlyInput>();

  useEffect(() => {
    current.current = input;
    if (!input) {
      setState(undefined);
      return;
    }
    setState({ status: 'running' });
    void runTokensOnly(input).then((result) => {
      if (current.current === input) setState({ status: 'done', result });
    });
    return () => {
      if (current.current === input) current.current = undefined;
    };
  }, [input]);

  return state;
}
