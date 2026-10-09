import { useInput } from 'ink';
import { keyAction } from './logic.js';

export const CREDENTIALS_CONTROLS = [
  { keys: 'Enter', label: 'Next field / Continue' },
  { keys: 'Tab', label: 'Switch field' },
  { keys: 'Ctrl+S', label: 'Skip (no push)' },
  { keys: 'Esc', label: 'Back' },
] as const;

interface CredentialsHandlers {
  disabled: boolean;
  onBack: () => void;
  onNextField: () => void;
  onSkip: () => void;
}

export function useCredentialsControls(handlers: CredentialsHandlers): void {
  useInput((input, key) => {
    if (handlers.disabled) return;
    const action = keyAction(input, key);
    if (action === 'back') handlers.onBack();
    else if (action === 'next-field') handlers.onNextField();
    else if (action === 'skip') handlers.onSkip();
  });
}
