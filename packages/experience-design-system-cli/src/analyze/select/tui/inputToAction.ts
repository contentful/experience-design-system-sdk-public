import type { AppAction, AppState, applyEditorKey } from './state.js';

// Full key shape from useImmediateInput — superset of what applyEditorKey needs
export type Key = Parameters<typeof applyEditorKey>[2] & {
  tab: boolean;
  pageUp: boolean;
  pageDown: boolean;
  shift: boolean;
};

/**
 * Pure function: maps a keypress to an AppAction (or null).
 * No hooks. No closures over stale React state.
 * Branching is on mode — the committed state from the reducer.
 */
export function inputToAction(
  input: string,
  key: Key,
  state: AppState,
  visibleCount: number,
  terminalWidth: number,
): AppAction | null {
  const { mode } = state;

  // ── Dialog ────────────────────────────────────────────────────────────────
  if (mode.type === 'dialog') {
    if (input === 'y' || key.return) {
      if (mode.which === 'finalize') return { type: 'FINALIZE_CONFIRM' };
      if (mode.which === 'quit') return { type: 'QUIT_CONFIRM' };
      return { type: 'CLOSE_DIALOG' };
    }
    if (input === 'n' || key.escape) return { type: 'CLOSE_DIALOG' };
    return null;
  }

  // ── Editing ───────────────────────────────────────────────────────────────
  if (mode.type === 'editing') {
    if (key.ctrl && input === 's') return { type: 'EDITOR_VALIDATE' };
    if (key.escape) return { type: 'DRAFT_DISCARD' };
    // All other keys go to the editor
    return { type: 'EDITOR_KEY', input, key, visibleHeight: visibleCount - 4 };
  }

  // ── Finalized ─────────────────────────────────────────────────────────────
  if (mode.type === 'finalized') {
    if (key.return || input === 'q' || key.escape) process.exit(0);
    return null;
  }

  // ── Browsing ──────────────────────────────────────────────────────────────
  if (input === 'q') return { type: 'OPEN_DIALOG', which: 'quit' };
  if (input === '?') return { type: 'OPEN_DIALOG', which: 'help' };
  if (input === 'F') return { type: 'OPEN_DIALOG', which: 'finalize' };
  if (key.tab) return { type: 'TOGGLE_FOCUS' };
  if (input === 'a') return { type: 'ACCEPT' };
  if (input === 'r') return { type: 'REJECT' };
  if (input === 'e') return { type: 'ENTER_EDIT' };
  if (input === 's') return { type: 'TOGGLE_SOURCE', terminalWidth };
  if (input === 'A') return { type: 'APPROVE_ALL' };

  if (mode.sidebarFocused) {
    if (key.upArrow || input === 'k') return { type: 'SIDEBAR_UP', visibleCount };
    if (key.downArrow || input === 'j') return { type: 'SIDEBAR_DOWN', visibleCount };
  } else {
    if (key.upArrow || input === 'k') return { type: 'SCROLL_UP' };
    if (key.downArrow || input === 'j') return { type: 'SCROLL_DOWN' };
  }

  return null;
}
