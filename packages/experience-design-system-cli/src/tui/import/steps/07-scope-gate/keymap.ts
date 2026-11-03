// What a key press means at the gate, with no React. The screen keeps the cursor, the open panel and the search text;
// this turns (key, what is open, what is true right now) into one named action, so the 90-line `useImmediateInput`
// branch in legacy becomes a table that can be tested row by row. Modes are checked in the same order legacy checked
// them: help, reject prompt, search, cycles panel, flags panel, then the main keys.

export type GateMode = 'help' | 'reject-prompt' | 'search' | 'cycles' | 'flags' | 'main';

export interface KeyPress {
  input: string;
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  shiftTab?: boolean;
  ctrl?: boolean;
}

/** What legacy looked at besides the key and the open panel. */
export interface GateContext {
  focusedColumn: 'main' | 'tokens';
  /** The layout has only the main column, so Tab has nowhere to go. */
  singleColumn: boolean;
  hasCycles: boolean;
  /** Some component was flagged by the AI with a reason to show. */
  hasFlagReasons: boolean;
  /** A jump filter is on, so Esc clears it before it quits. */
  jumpFilterActive: boolean;
  /** Search text is set, so Esc clears it before it quits. */
  searchActive: boolean;
  /** The list in the focused column has no rows, so the arrows have nothing to move. */
  focusedListEmpty: boolean;
}

export type GateAction =
  | { type: 'none' }
  | { type: 'quit' }
  | { type: 'confirm' }
  | { type: 'close-help' }
  | { type: 'answer-reject-prompt'; confirm: boolean }
  | { type: 'close-panel' }
  | { type: 'close-search' }
  | { type: 'submit-search' }
  | { type: 'search-input' }
  | { type: 'clear-jump-filter' }
  | { type: 'clear-search' }
  | { type: 'move'; delta: -1 | 1 }
  | { type: 'jump-to-selected' }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'toggle-all' }
  | { type: 'accept-unflagged' }
  | { type: 'toggle-group' }
  | { type: 'expand-all' }
  | { type: 'collapse-all' }
  | { type: 'switch-column'; delta: -1 | 1 }
  | { type: 'open-panel'; panel: 'cycles' | 'flags' | 'help' | 'search' }
  | { type: 'toggle-dependencies' }
  | { type: 'toggle-cycle-filter' }
  | { type: 'toggle-jump-filter' }
  | { type: 'toggle-view' };

const NONE: GateAction = { type: 'none' };

export function resolveKey(mode: GateMode, key: KeyPress, ctx: GateContext): GateAction {
  switch (mode) {
    case 'help':
      return key.input === 'h' || key.escape ? { type: 'close-help' } : NONE;
    case 'reject-prompt':
      if (key.input === 'y' || key.input === 'Y') return { type: 'answer-reject-prompt', confirm: true };
      if (key.input === 'n' || key.input === 'N' || key.escape) return { type: 'answer-reject-prompt', confirm: false };
      return NONE;
    case 'search':
      if (key.escape) return { type: 'close-search' };
      if (key.return) return { type: 'submit-search' };
      return { type: 'search-input' };
    case 'cycles':
      if (key.escape || key.input === 'c') return { type: 'close-panel' };
      if (key.upArrow) return { type: 'move', delta: -1 };
      if (key.downArrow) return { type: 'move', delta: 1 };
      if (key.return) return { type: 'jump-to-selected' };
      return NONE;
    case 'flags':
      // The flags panel closes itself on its toggle key and Esc (see useOverlayPanel); the screen asks it first.
      if (key.upArrow) return { type: 'move', delta: -1 };
      if (key.downArrow) return { type: 'move', delta: 1 };
      if (key.return) return { type: 'jump-to-selected' };
      return NONE;
    case 'main':
      return resolveMain(key, ctx);
  }
}

function resolveMain(key: KeyPress, ctx: GateContext): GateAction {
  const { input } = key;
  const inMain = ctx.focusedColumn === 'main';

  if (input === 'q' || key.escape) {
    if (key.escape && ctx.jumpFilterActive) return { type: 'clear-jump-filter' };
    if (key.escape && ctx.searchActive) return { type: 'clear-search' };
    return { type: 'quit' };
  }
  if (input === 'h') return { type: 'open-panel', panel: 'help' };
  if (input === 'f' || input === 'F') return { type: 'confirm' };
  if (input === 'c') return ctx.hasCycles ? { type: 'open-panel', panel: 'cycles' } : NONE;
  if (input === 'd') return { type: 'toggle-dependencies' };
  if (input === 'x') return ctx.hasFlagReasons ? { type: 'open-panel', panel: 'flags' } : NONE;
  if (input === '/') return { type: 'open-panel', panel: 'search' };
  if (input === 'o') return ctx.hasCycles ? { type: 'toggle-cycle-filter' } : NONE;
  if (input === 'i' && !key.tab && !key.ctrl) return inMain ? { type: 'toggle-jump-filter' } : NONE;
  if (input === ' ') return inMain ? { type: 'toggle-group' } : NONE;
  if (input === 'E') return inMain ? { type: 'expand-all' } : NONE;
  if (input === 'C') return inMain ? { type: 'collapse-all' } : NONE;
  if (input === 'a') return inMain ? { type: 'accept' } : NONE;
  if (input === 'r') return inMain ? { type: 'reject' } : NONE;
  if (input === 'L') return { type: 'toggle-view' };
  if (input === 'A') return { type: 'toggle-all' };
  if (input === 'Y') return { type: 'accept-unflagged' };
  if (key.tab) {
    if (ctx.singleColumn) return NONE;
    return { type: 'switch-column', delta: key.shiftTab ? -1 : 1 };
  }
  if (key.upArrow) return ctx.focusedListEmpty ? NONE : { type: 'move', delta: -1 };
  if (key.downArrow) return ctx.focusedListEmpty ? NONE : { type: 'move', delta: 1 };
  return NONE;
}
