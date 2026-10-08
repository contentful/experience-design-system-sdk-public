import { useInput } from 'ink';
import { shouldQuit } from './logic.js';

export const WELCOME_CONTROLS = [
  { keys: 'Enter', label: 'Continue' },
  { keys: 'Esc/q', label: 'Back to menu' },
] as const;

export function useWelcomeControls(projectPath: string, onQuit: () => void): void {
  useInput((input, key) => {
    if (shouldQuit(projectPath, input, key)) onQuit();
  });
}
