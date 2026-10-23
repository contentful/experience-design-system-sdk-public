import { useInput } from 'ink';
import { keyAction, type PathPhase } from './logic.js';

interface Control {
  keys: string;
  label: string;
}

interface PathValidationHandlers {
  onConfirm: () => void;
  onChangePath: () => void;
  onBack: () => void;
}

const CONTROLS: Record<PathPhase, readonly Control[]> = {
  scanning: [{ keys: 'Esc', label: 'Back' }],
  ready: [
    { keys: 'Enter', label: 'Yes, continue' },
    { keys: 'e', label: 'Change path' },
    { keys: 'Esc', label: 'Back' },
  ],
  failed: [
    { keys: 'Enter/e', label: 'Try a different path' },
    { keys: 'Esc', label: 'Back' },
  ],
};

export function controlsFor(phase: PathPhase): readonly Control[] {
  return CONTROLS[phase];
}

export function usePathValidationControls(phase: PathPhase, handlers: PathValidationHandlers): void {
  useInput((input, key) => {
    const action = keyAction(phase, input, key);
    if (action === 'confirm') handlers.onConfirm();
    else if (action === 'change-path') handlers.onChangePath();
    else if (action === 'back') handlers.onBack();
  });
}
