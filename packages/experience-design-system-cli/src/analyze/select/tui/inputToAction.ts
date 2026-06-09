import type { AppAction, AppState } from './state.js';

// Key shape produced by useImmediateInput's parseInput()
export type Key = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
};

/**
 * Pure function: maps a raw keypress to an AppAction (or null if no action).
 *
 * No hooks. No closures over stale React state. All branching is on the
 * current mode, which comes from the reducer's committed state.
 *
 * When mode=editing, only Ctrl+S and Esc produce actions — all other keys
 * return null so JsonEditor's own useImmediateInput listener handles them.
 */
export function inputToAction(
  input: string,
  key: Key,
  state: AppState,
  visibleCount: number,
  terminalWidth: number,
): AppAction | null {
  const { mode } = state;

  // ── Dialog mode: only y/Enter and n/Esc ──────────────────────────────────
  if (mode.type === 'dialog') {
    if (input === 'y' || key.return) {
      if (mode.which === 'finalize') return { type: 'FINALIZE_CONFIRM' };
      if (mode.which === 'quit') return { type: 'QUIT_CONFIRM' };
      return { type: 'CLOSE_DIALOG' };
    }
    if (input === 'n' || key.escape) return { type: 'CLOSE_DIALOG' };
    return null;
  }

  // ── Editing mode: Ctrl+S / Esc only — all other keys go to JsonEditor ────
  if (mode.type === 'editing') {
    if (key.ctrl && input === 's') return { type: 'DRAFT_SAVE' };
    if (key.escape) return { type: 'DRAFT_DISCARD' };
    return null;
  }

  // ── Finalized mode ────────────────────────────────────────────────────────
  if (mode.type === 'finalized') {
    if (key.return || input === 'q' || key.escape) process.exit(0);
    return null;
  }

  // ── Browsing mode ─────────────────────────────────────────────────────────
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
