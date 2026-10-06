import { useInput } from 'ink';
import { shouldGoBack, shouldSkip } from './logic.js';

export const TOKEN_INPUT_CONTROLS = [
  { keys: 'Enter', label: 'Continue (skips if empty)' },
  { keys: 's', label: 'Skip' },
  { keys: 'Esc/q', label: 'Back' },
] as const;

export function useTokenInputControls(tokenPath: string, onSkip: () => void, onBack: () => void): void {
  useInput((input, key) => {
    if (shouldGoBack(tokenPath, input, key)) onBack();
    else if (shouldSkip(tokenPath, input, key)) onSkip();
  });
}
