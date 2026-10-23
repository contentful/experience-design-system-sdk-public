import { useInput } from 'ink';
import { errorAction } from './logic.js';

interface ErrorHandlers {
  onExit: () => void;
  onRetry?: () => void;
  onAcknowledge?: () => void;
}

export function useErrorControls(handlers: ErrorHandlers): void {
  useInput((input, key) => {
    const action = errorAction(input, key, {
      canRetry: handlers.onRetry !== undefined,
      canAcknowledge: handlers.onAcknowledge !== undefined,
    });
    if (action === 'acknowledge') handlers.onAcknowledge?.();
    else if (action === 'retry') handlers.onRetry?.();
    else if (action === 'exit') handlers.onExit();
  });
}
