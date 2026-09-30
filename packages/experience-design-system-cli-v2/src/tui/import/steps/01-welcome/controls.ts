import { useInput } from 'ink';
import { reducePathInput } from './logic.js';
import type { WelcomeScreenProps } from './types.js';

/** The key hints shown under the form. Kept next to the handler below so the two cannot drift apart. */
export const WELCOME_CONTROLS = [
  { keys: 'Enter', label: 'Continue' },
  { keys: 'Esc/q', label: 'Back to menu' },
] as const;

interface UseWelcomeControlsOptions extends WelcomeScreenProps {
  projectPath: string;
  setProjectPath: (projectPath: string) => void;
}

/** Wires the keyboard to the Welcome screen: `logic.ts` decides what a key means, this applies it. */
export function useWelcomeControls({
  projectPath,
  setProjectPath,
  onContinue,
  onQuit,
}: UseWelcomeControlsOptions): void {
  useInput((input, key) => {
    const event = reducePathInput(projectPath, input, key);
    if (event.type === 'edit') setProjectPath(event.value);
    else if (event.type === 'submit') onContinue(event.projectPath);
    else if (event.type === 'quit') onQuit();
  });
}
