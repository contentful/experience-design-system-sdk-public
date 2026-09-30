import { useInput } from 'ink';
import { reduceTokenInput, rejectPath, type TokenInputState } from './logic.js';
import type { TokenInputScreenProps } from './types.js';
import { validateTokenPath } from './validate-path.js';

/** The key hints shown under the form. Kept next to the handler below so the two cannot drift apart. */
export const TOKEN_INPUT_CONTROLS = [
  { keys: 'Enter', label: 'Submit / Skip if empty' },
  { keys: 's', label: 'Skip' },
  { keys: 'Esc/q', label: 'Back to menu' },
] as const;

interface UseTokenInputControlsOptions extends TokenInputScreenProps {
  state: TokenInputState;
  setState: (state: TokenInputState) => void;
}

/**
 * Wires the keyboard to the token-input screen: `logic.ts` decides what a key means, this applies it.
 * A `submit` action is checked with `validateTokenPath` before anything is reported, so `onConfirm` only ever
 * fires for a file that exists, and the screen has finished its work before the next one can start.
 */
export function useTokenInputControls({
  state,
  setState,
  onConfirm,
  onSkip,
  onQuit,
}: UseTokenInputControlsOptions): void {
  useInput((input, key) => {
    const update = reduceTokenInput(state, input, key);
    setState(update.state);

    const action = update.action;
    if (!action) return;
    if (action.type === 'skip') onSkip();
    else if (action.type === 'quit') onQuit();
    else {
      const check = validateTokenPath(action.rawPath);
      if (check.ok) onConfirm(check.path);
      else setState(rejectPath(update.state, { error: check.error, resolvedPath: check.resolvedPath }));
    }
  });
}
