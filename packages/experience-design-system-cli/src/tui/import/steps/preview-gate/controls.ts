import { useInput, type Key } from 'ink';
import { previewAction } from './logic.js';

interface Control {
  keys: string;
  label: string;
}

interface PreviewGateHandlers {
  diffExpanded: boolean;
  onConfirm: () => void;
  onToggleDiff: () => void;
  onEdit: () => void;
  onQuit: () => void;
  onScroll: (input: string, key: Key) => void;
}

export function controlsFor(diffExpanded: boolean, hasBreakingChanges: boolean): readonly Control[] {
  return [
    { keys: 'Enter', label: hasBreakingChanges ? 'Acknowledge and push' : 'Push to Contentful' },
    { keys: 'd', label: diffExpanded ? 'Hide diff' : 'Show diff' },
    ...(diffExpanded ? [{ keys: '↑↓ f/b', label: 'Scroll / page' }] : []),
    { keys: 'e', label: 'Edit definitions' },
    { keys: 'Esc', label: 'Cancel' },
  ];
}

export function usePreviewGateControls(handlers: PreviewGateHandlers): void {
  useInput((input, key) => {
    const action = previewAction(input, key, handlers.diffExpanded);
    if (action === 'confirm') handlers.onConfirm();
    else if (action === 'toggle-diff') handlers.onToggleDiff();
    else if (action === 'edit') handlers.onEdit();
    else if (action === 'quit') handlers.onQuit();
    else if (action === 'scroll') handlers.onScroll(input, key);
  });
}
