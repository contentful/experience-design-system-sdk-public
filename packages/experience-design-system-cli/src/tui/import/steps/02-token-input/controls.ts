import { useInput } from 'ink';
import { shouldGoBack } from './logic.js';

export const TOKEN_INPUT_CONTROLS = [
  { keys: 'Enter', label: 'Continue' },
  { keys: 'Esc', label: 'Back' },
] as const;

export function useTokenInputControls(onBack: () => void): void {
  useInput((_input, key) => {
    if (shouldGoBack(key)) onBack();
  });
}
