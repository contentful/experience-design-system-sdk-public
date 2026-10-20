import { useInput } from 'ink';
import { CLEAR_CONTROL } from '../../../clear-shortcut.js';
import { shouldGoBack } from './logic.js';

export const TOKEN_INPUT_CONTROLS = [
  { keys: 'Enter', label: 'Continue' },
  CLEAR_CONTROL,
  { keys: 'Esc', label: 'Back' },
] as const;

export function useTokenInputControls(onBack: () => void): void {
  useInput((_input, key) => {
    if (shouldGoBack(key)) onBack();
  });
}
