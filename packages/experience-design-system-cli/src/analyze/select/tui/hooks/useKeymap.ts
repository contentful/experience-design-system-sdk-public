import { useImmediateInput } from './useImmediateInput.js';

type KeymapContext = {
  sidebarFocused: boolean;
  editMode: boolean;
  dialogOpen: boolean;
};

type KeymapHandlers = {
  onSidebarUp: () => void;
  onSidebarDown: () => void;
  onAccept: () => void;
  onReject: () => void;
  onEnterEditMode: () => void;
  onToggleSource: () => void;
  onScrollUp: () => void;
  onScrollDown: () => void;
  onToggleFocus: () => void;
  onApproveAll: () => void;
  onFinalize: () => void;
  onQuit: () => void;
  onToggleHelp: () => void;
};

export function useKeymap(context: KeymapContext, handlers: KeymapHandlers): void {
  useImmediateInput((input, key) => {
    if (context.dialogOpen) return;
    if (context.editMode) return;

    if (input === 'q') {
      handlers.onQuit();
      return;
    }
    if (input === '?') {
      handlers.onToggleHelp();
      return;
    }
    if (key.tab) {
      handlers.onToggleFocus();
      return;
    }
    if (input === 'A') {
      handlers.onApproveAll();
      return;
    }
    if (input === 'F') {
      handlers.onFinalize();
      return;
    }
    if (input === 'a') {
      handlers.onAccept();
      return;
    }
    if (input === 'r') {
      handlers.onReject();
      return;
    }
    if (input === 'e') {
      handlers.onEnterEditMode();
      return;
    }
    if (input === 's') {
      handlers.onToggleSource();
      return;
    }

    if (context.sidebarFocused) {
      if (key.upArrow || input === 'k') handlers.onSidebarUp();
      else if (key.downArrow || input === 'j') handlers.onSidebarDown();
    } else {
      if (key.upArrow || input === 'k') handlers.onScrollUp();
      else if (key.downArrow || input === 'j') handlers.onScrollDown();
    }
  });
}
