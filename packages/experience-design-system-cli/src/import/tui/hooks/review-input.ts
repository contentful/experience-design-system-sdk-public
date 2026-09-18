import type { ImmediateInputKey } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { computeNextScrollOffset } from '../../../analyze/select/tui/hooks/scroll-offset.js';
import type { ReviewPanel, UseReviewEditorResult } from './useReviewEditor.js';

const PANEL_CONTENT_HEIGHT = 12;

type ReviewOverlayInputState = {
  loading: boolean;
  loadError: string | null;
  showFinalize: boolean;
  dialogOpen: boolean;
  showHelp?: boolean;
  showReloadDialog: boolean;
  finalizePreview: { scrollBy: (delta: number) => void };
  reloadFromSave: () => void;
  setShowReloadDialog: (open: boolean) => void;
  onQuit: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
};

export function handleReviewOverlayInput(
  input: string,
  key: ImmediateInputKey,
  state: ReviewOverlayInputState,
): boolean {
  if (state.loading) return true;
  if (state.loadError) {
    if (input === 'q' || key.escape || key.return) state.onQuit();
    return true;
  }
  if (state.showFinalize) {
    // The dialog owns y/n/Enter/Esc; here we own j/k scroll of its deletion list.
    if (input === 'j' || key.downArrow) {
      state.finalizePreview.scrollBy(1);
      return true;
    }
    if (input === 'k' || key.upArrow) {
      state.finalizePreview.scrollBy(-1);
      return true;
    }
    return true;
  }
  if (state.dialogOpen || state.showHelp) return true;

  if (state.showReloadDialog) {
    if (key.return) {
      state.reloadFromSave();
      state.setShowReloadDialog(false);
      return true;
    }
    if (key.escape) {
      state.setShowReloadDialog(false);
      return true;
    }
    return true;
  }

  if (key.ctrl && input === 'z') {
    state.handleUndo();
    return true;
  }
  if (key.ctrl && input === 'y') {
    state.handleRedo();
    return true;
  }
  if (key.ctrl && input === 'r') {
    state.setShowReloadDialog(true);
    return true;
  }
  return false;
}

type TokenReviewInputState = Pick<
  UseReviewEditorResult,
  | 'panelOpen'
  | 'setPanelOpen'
  | 'tokenReviewRow'
  | 'setTokenReviewRow'
  | 'tokenReviewEditing'
  | 'setTokenReviewEditing'
  | 'tokenReviewEditCursor'
  | 'setTokenReviewEditCursor'
  | 'tokenReviewEditSelection'
  | 'setTokenReviewEditSelection'
  | 'currentTokenSuggestions'
  | 'handleTokenEditSave'
>;

function handleTokenReviewInput(input: string, key: ImmediateInputKey, state: TokenReviewInputState): boolean {
  if (state.panelOpen !== 'token-review') return false;

  const suggestions = state.currentTokenSuggestions();
  const row = suggestions[state.tokenReviewRow];

  if (state.tokenReviewEditing) {
    if (row && row.paths.length > 0) {
      if (key.upArrow || input === 'k') {
        state.setTokenReviewEditCursor((cursor) => Math.max(0, cursor - 1));
        return true;
      }
      if (key.downArrow || input === 'j') {
        state.setTokenReviewEditCursor((cursor) => Math.min(row.paths.length - 1, cursor + 1));
        return true;
      }
      if (input === ' ' || key.return) {
        const path = row.paths[state.tokenReviewEditCursor];
        state.setTokenReviewEditSelection((previous) => {
          const next = new Set(previous);
          if (next.has(path) && next.size === 1) return next;
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        return true;
      }
      if (key.ctrl && input === 's') {
        state.handleTokenEditSave(row);
        return true;
      }
    }
    if (key.escape) {
      state.setTokenReviewEditing(false);
      return true;
    }
    return true;
  }

  if (key.upArrow || input === 'k') {
    state.setTokenReviewRow((rowIndex) => Math.max(0, rowIndex - 1));
    return true;
  }
  if (key.downArrow || input === 'j') {
    state.setTokenReviewRow((rowIndex) => Math.min(Math.max(0, suggestions.length - 1), rowIndex + 1));
    return true;
  }
  if (key.return && row) {
    state.setTokenReviewEditCursor(0);
    state.setTokenReviewEditSelection(new Set(row.allowed));
    state.setTokenReviewEditing(true);
    return true;
  }
  if (key.escape || input === 't') {
    state.setPanelOpen('none');
    return true;
  }
  return true;
}

type RationalePanelInputState = Pick<
  UseReviewEditorResult,
  'panelOpen' | 'setPanelOpen' | 'panelScrollOffset' | 'setPanelScrollOffset'
> & {
  propKey: string;
  componentKey: string;
};

type ReviewPanelState = Pick<UseReviewEditorResult, 'setPanelOpen' | 'setPanelScrollOffset'>;

function setReviewPanel(state: ReviewPanelState, panel: ReviewPanel): void {
  state.setPanelOpen(panel);
  state.setPanelScrollOffset(() => 0);
}

type RationalePanel = Exclude<ReviewPanel, 'none' | 'token-review'>;

function rationalePanelForInput(input: string, propKey: string, componentKey: string): RationalePanel | null {
  if (input === propKey) return 'prop-rationale';
  if (input === componentKey) return 'component-rationale';
  if (input === 's') return 'source';
  return null;
}

function handleRationalePanelInput(
  input: string,
  key: ImmediateInputKey,
  state: RationalePanelInputState,
): boolean {
  if (state.panelOpen === 'none' || state.panelOpen === 'token-review') return false;

  const next = computeNextScrollOffset(state.panelScrollOffset, input, key, 9999, PANEL_CONTENT_HEIGHT);
  if (next !== null) {
    state.setPanelScrollOffset(() => next);
    return true;
  }
  if (key.escape) {
    setReviewPanel(state, 'none');
    return true;
  }

  const togglable = !key.ctrl && !key.tab && !key.meta && !key.return;
  if (!togglable) return true;

  const panel = rationalePanelForInput(input, state.propKey, state.componentKey);
  if (panel) setReviewPanel(state, state.panelOpen === panel ? 'none' : panel);
  return true;
}

export type ReviewPanelShortcutState = TokenReviewInputState &
  RationalePanelInputState & {
    textEntryActive: boolean;
    showJson: boolean;
  };

export function handleReviewPanelShortcuts(
  input: string,
  key: ImmediateInputKey,
  state: ReviewPanelShortcutState,
): boolean {
  if (handleTokenReviewInput(input, key, state)) return true;
  if (handleRationalePanelInput(input, key, state)) return true;

  const rationaleKeyOk = !state.textEntryActive && !state.showJson && !key.ctrl && !key.tab && !key.meta && !key.return;
  if (!rationaleKeyOk) return false;

  const panel = rationalePanelForInput(input, state.propKey, state.componentKey);
  if (panel) {
    setReviewPanel(state, panel);
    return true;
  }
  if (input === 't' && state.currentTokenSuggestions().length > 0) {
    state.setPanelOpen('token-review');
    state.setTokenReviewRow(0);
    return true;
  }
  return false;
}

export type ReviewViewToggleInputState = Pick<
  UseReviewEditorResult,
  'setShowJson' | 'setShowHiddenProps' | 'setJsonScrollOffset' | 'pendingGRef'
>;

export function handleReviewViewToggleInput(input: string, state: ReviewViewToggleInputState): boolean {
  if (input === 'J') {
    state.setShowJson((previous) => !previous);
    state.setJsonScrollOffset(0);
    state.pendingGRef.current = false;
    return true;
  }
  if (input === 'H') {
    state.setShowHiddenProps((previous) => !previous);
    state.setJsonScrollOffset(0);
    state.pendingGRef.current = false;
    return true;
  }
  return false;
}

type JsonPanelInputState = Pick<UseReviewEditorResult, 'jsonScrollOffset' | 'setJsonScrollOffset' | 'pendingGRef'> & {
  sidebarFocused: boolean;
  showJson: boolean;
  jsonValue: string;
  height: number;
};

export function handleJsonPanelInput(input: string, key: ImmediateInputKey, state: JsonPanelInputState): boolean {
  if (state.sidebarFocused || !state.showJson) return false;

  const totalLines = state.jsonValue.split('\n').length;
  const maxOffset = Math.max(0, totalLines - state.height);
  if (input === 'g' && !key.ctrl) {
    if (state.pendingGRef.current) {
      state.pendingGRef.current = false;
      state.setJsonScrollOffset(() => 0);
      return true;
    }
    state.pendingGRef.current = true;
    return true;
  }

  const next = computeNextScrollOffset(state.jsonScrollOffset, input, key, totalLines, state.height);
  if (next !== null) {
    state.pendingGRef.current = false;
    const clamped = Math.min(maxOffset, Math.max(0, next));
    state.setJsonScrollOffset(() => clamped);
    return true;
  }
  state.pendingGRef.current = false;
  return true;
}
