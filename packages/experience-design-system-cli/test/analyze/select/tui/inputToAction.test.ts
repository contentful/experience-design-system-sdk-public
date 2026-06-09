import { describe, it, expect } from 'vitest';
import { inputToAction } from '../../../../src/analyze/select/tui/inputToAction.js';
import { initialState } from '../../../../src/analyze/select/tui/state.js';
import type { AppState } from '../../../../src/analyze/select/tui/state.js';
import type { Key } from '../../../../src/analyze/select/tui/inputToAction.js';

const noKey: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
};

const browsing: AppState = {
  ...initialState,
  mode: { type: 'browsing', sidebarFocused: true, sourceVisible: false },
  session: { components: [] },
  sortedIds: ['a', 'b', 'c'],
  selectedId: 'b',
};

describe('inputToAction — browsing mode', () => {
  it('q opens quit dialog', () => {
    expect(inputToAction('q', noKey, browsing, 20, 120)).toEqual({ type: 'OPEN_DIALOG', which: 'quit' });
  });

  it('? opens help dialog', () => {
    expect(inputToAction('?', noKey, browsing, 20, 120)).toEqual({ type: 'OPEN_DIALOG', which: 'help' });
  });

  it('a accepts current component', () => {
    expect(inputToAction('a', noKey, browsing, 20, 120)).toEqual({ type: 'ACCEPT' });
  });

  it('r rejects current component', () => {
    expect(inputToAction('r', noKey, browsing, 20, 120)).toEqual({ type: 'REJECT' });
  });

  it('e enters edit mode', () => {
    expect(inputToAction('e', noKey, browsing, 20, 120)).toEqual({ type: 'ENTER_EDIT' });
  });

  it('upArrow moves sidebar up with visibleCount', () => {
    expect(inputToAction('', { ...noKey, upArrow: true }, browsing, 20, 120)).toEqual({
      type: 'SIDEBAR_UP',
      visibleCount: 20,
    });
  });

  it('downArrow moves sidebar down', () => {
    expect(inputToAction('', { ...noKey, downArrow: true }, browsing, 20, 120)).toEqual({
      type: 'SIDEBAR_DOWN',
      visibleCount: 20,
    });
  });

  it('k/j work as arrow keys', () => {
    expect(inputToAction('k', noKey, browsing, 20, 120)).toEqual({ type: 'SIDEBAR_UP', visibleCount: 20 });
    expect(inputToAction('j', noKey, browsing, 20, 120)).toEqual({ type: 'SIDEBAR_DOWN', visibleCount: 20 });
  });

  it('tab toggles focus', () => {
    expect(inputToAction('', { ...noKey, tab: true }, browsing, 20, 120)).toEqual({ type: 'TOGGLE_FOCUS' });
  });

  it('up/down scroll detail panel when sidebar not focused', () => {
    const detailFocused: AppState = {
      ...browsing,
      mode: { type: 'browsing', sidebarFocused: false, sourceVisible: false },
    };
    expect(inputToAction('k', noKey, detailFocused, 20, 120)).toEqual({ type: 'SCROLL_UP' });
    expect(inputToAction('j', noKey, detailFocused, 20, 120)).toEqual({ type: 'SCROLL_DOWN' });
  });

  it('A approves all', () => {
    expect(inputToAction('A', noKey, browsing, 20, 120)).toEqual({ type: 'APPROVE_ALL' });
  });

  it('F opens finalize dialog', () => {
    expect(inputToAction('F', noKey, browsing, 20, 120)).toEqual({ type: 'OPEN_DIALOG', which: 'finalize' });
  });

  it('s warns when terminal too narrow', () => {
    expect(inputToAction('s', noKey, browsing, 20, 100)).toEqual({ type: 'TOGGLE_SOURCE', terminalWidth: 100 });
  });
});

describe('inputToAction — dialog mode', () => {
  const finDialog: AppState = {
    ...browsing,
    mode: { type: 'dialog', which: 'finalize' },
  };
  const quitDialog: AppState = {
    ...browsing,
    mode: { type: 'dialog', which: 'quit' },
  };
  const helpDialog: AppState = {
    ...browsing,
    mode: { type: 'dialog', which: 'help' },
  };

  it('y confirms finalize', () => {
    expect(inputToAction('y', noKey, finDialog, 20, 120)).toEqual({ type: 'FINALIZE_CONFIRM' });
  });

  it('Enter confirms quit', () => {
    expect(inputToAction('', { ...noKey, return: true }, quitDialog, 20, 120)).toEqual({ type: 'QUIT_CONFIRM' });
  });

  it('n cancels any dialog', () => {
    expect(inputToAction('n', noKey, finDialog, 20, 120)).toEqual({ type: 'CLOSE_DIALOG' });
    expect(inputToAction('n', noKey, quitDialog, 20, 120)).toEqual({ type: 'CLOSE_DIALOG' });
  });

  it('Esc cancels any dialog', () => {
    expect(inputToAction('', { ...noKey, escape: true }, helpDialog, 20, 120)).toEqual({ type: 'CLOSE_DIALOG' });
  });

  it('unrelated keys return null', () => {
    expect(inputToAction('a', noKey, finDialog, 20, 120)).toBeNull();
    expect(inputToAction('r', noKey, finDialog, 20, 120)).toBeNull();
  });
});

describe('inputToAction — editing mode', () => {
  const editing: AppState = {
    ...browsing,
    mode: { type: 'editing', componentId: 'b' },
  };

  it('Ctrl+S saves draft', () => {
    expect(inputToAction('s', { ...noKey, ctrl: true }, editing, 20, 120)).toEqual({ type: 'DRAFT_SAVE' });
  });

  it('Esc discards draft', () => {
    expect(inputToAction('', { ...noKey, escape: true }, editing, 20, 120)).toEqual({ type: 'DRAFT_DISCARD' });
  });

  it('all other keys return null (handled by JsonEditor)', () => {
    expect(inputToAction('a', noKey, editing, 20, 120)).toBeNull();
    expect(inputToAction('', { ...noKey, upArrow: true }, editing, 20, 120)).toBeNull();
    expect(inputToAction('x', noKey, editing, 20, 120)).toBeNull();
  });
});
