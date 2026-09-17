import type { ImmediateInputKey } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { computeNextScrollOffset } from '../../../analyze/select/tui/hooks/scroll-offset.js';
import type { UseReviewEditorResult } from './useReviewEditor.js';

const PANEL_CONTENT_HEIGHT = 12;

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

export function handleTokenReviewInput(input: string, key: ImmediateInputKey, state: TokenReviewInputState): boolean {
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

export function handleRationalePanelInput(
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
    state.setPanelOpen('none');
    state.setPanelScrollOffset(() => 0);
    return true;
  }

  const togglable = !key.ctrl && !key.tab && !key.meta && !key.return;
  if (!togglable) return true;

  if (input === state.propKey && state.panelOpen === 'prop-rationale') {
    state.setPanelOpen('none');
    state.setPanelScrollOffset(() => 0);
    return true;
  }
  if (input === state.componentKey && state.panelOpen === 'component-rationale') {
    state.setPanelOpen('none');
    state.setPanelScrollOffset(() => 0);
    return true;
  }
  if (input === 's' && state.panelOpen === 'source') {
    state.setPanelOpen('none');
    state.setPanelScrollOffset(() => 0);
    return true;
  }
  if (input === state.propKey) {
    state.setPanelOpen('prop-rationale');
    state.setPanelScrollOffset(() => 0);
    return true;
  }
  if (input === state.componentKey) {
    state.setPanelOpen('component-rationale');
    state.setPanelScrollOffset(() => 0);
    return true;
  }
  if (input === 's') {
    state.setPanelOpen('source');
    state.setPanelScrollOffset(() => 0);
    return true;
  }
  return true;
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
