import { useInput } from 'ink';
import { IMPORT_TARGET_OPTIONS, moveFocus, type ImportTarget } from './logic.js';

export const PREFLIGHT_CONTROLS = [
  { keys: '↑/↓', label: 'Choose' },
  { keys: 'Enter', label: 'Continue' },
  { keys: 'Esc', label: 'Back to menu' },
] as const;

export function usePreflightControls(handlers: {
  focus: number;
  onFocus: (focus: number) => void;
  onChoose: (target: ImportTarget) => void;
  onQuit: () => void;
}): void {
  useInput((_input, key) => {
    if (key.escape) handlers.onQuit();
    else if (key.return) handlers.onChoose(IMPORT_TARGET_OPTIONS[handlers.focus]!.target);
    else handlers.onFocus(moveFocus(handlers.focus, key, IMPORT_TARGET_OPTIONS.length));
  });
}
