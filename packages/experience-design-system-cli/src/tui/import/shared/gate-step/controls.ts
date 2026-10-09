import { useInput } from 'ink';
import { gateAction } from './logic.js';

interface GateHandlers {
  canSkip: boolean;
  onContinue: () => void;
  onSkip: () => void;
  onQuit: () => void;
}

export function useGateControls(handlers: GateHandlers): void {
  useInput((input, key) => {
    const action = gateAction(input, key, handlers.canSkip);
    if (action === 'continue') handlers.onContinue();
    else if (action === 'skip') handlers.onSkip();
    else if (action === 'quit') handlers.onQuit();
  });
}
