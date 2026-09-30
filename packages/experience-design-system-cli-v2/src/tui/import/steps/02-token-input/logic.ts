import { applyLineKey, type LineKey } from '../../input/line-editing.js';
import type { TokenPathFailure } from './validate-path.js';

/** Everything the screen displays, and everything a key press can change. */
export interface TokenInputState {
  value: string;
  /** Why the last submit was rejected, shown under the field. Cleared by any edit. */
  failure: TokenPathFailure | null;
}

export const INITIAL_TOKEN_INPUT_STATE: TokenInputState = { value: '', failure: null };

/** What the host has to do after a key press. Anything that touches the filesystem or the outside world lives here. */
export type TokenInputAction = { type: 'skip' } | { type: 'quit' } | { type: 'submit'; rawPath: string };

/** The new state after a key press, plus an action for the caller when the key press asks for one. */
export interface TokenInputUpdate {
  state: TokenInputState;
  action?: TokenInputAction;
}

/**
 * Decide what one key press means. Pure: no filesystem access, so Enter with text returns a `submit` action for
 * the caller to validate.
 *
 * Same quit rules as the Welcome screen: Esc always quits, and `q` quits only while the field is empty, so a path
 * such as `~/quiz/tokens.json` can still be typed. `s` skips on the same terms, so `~/styles/tokens.json` works.
 * Enter on an empty or whitespace-only field skips.
 */
export function reduceTokenInput(state: TokenInputState, input: string, key: LineKey): TokenInputUpdate {
  if (state.value === '' && !key.ctrl && !key.meta) {
    if (input === 's') return { state, action: { type: 'skip' } };
    if (input === 'q') return { state, action: { type: 'quit' } };
  }

  const edit = applyLineKey(state.value, input, key);
  switch (edit.type) {
    case 'change':
      return { state: { value: edit.value, failure: null } };
    case 'cancel':
      return { state, action: { type: 'quit' } };
    case 'submit': {
      const rawPath = state.value.trim();
      return { state, action: rawPath ? { type: 'submit', rawPath } : { type: 'skip' } };
    }
    case 'ignore':
      return { state };
  }
}

/** Record why a submitted path was rejected, so the screen can show it. */
export function rejectPath(state: TokenInputState, failure: TokenPathFailure): TokenInputState {
  return { ...state, failure };
}
