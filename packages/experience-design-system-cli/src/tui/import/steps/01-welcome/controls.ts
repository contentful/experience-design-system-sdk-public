import { useInput } from 'ink';
import { shouldQuit } from './logic.js';

export const WELCOME_CONTROLS = [
  { keys: 'Enter', label: 'Continue' },
  { keys: 'Ctrl+D', label: 'Clear' },
  { keys: 'Esc', label: 'Back to menu' },
] as const;

export function useWelcomeControls(onQuit: () => void): void {
  useInput((_input, key) => {
    if (shouldQuit(key)) onQuit();
  });
}
