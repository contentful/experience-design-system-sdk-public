import { describe, expect, it } from 'vitest';
import {
  resolveKey,
  type GateAction,
  type GateContext,
  type GateMode,
  type KeyPress,
} from '../../../src/tui/import/steps/07-scope-gate/keymap.js';

const ctx = (overrides: Partial<GateContext> = {}): GateContext => ({
  focusedColumn: 'main',
  singleColumn: false,
  hasCycles: true,
  hasFlagReasons: true,
  jumpFilterActive: false,
  searchActive: false,
  focusedListEmpty: false,
  ...overrides,
});

const press = (input: string, extra: Partial<KeyPress> = {}): KeyPress => ({ input, ...extra });
const key = {
  up: press('', { upArrow: true }),
  down: press('', { downArrow: true }),
  enter: press('', { return: true }),
  esc: press('', { escape: true }),
  tab: press('', { tab: true }),
  shiftTab: press('', { tab: true, shiftTab: true }),
};
const none: GateAction = { type: 'none' };

describe('help', () => {
  it.each([
    ['h', press('h'), { type: 'close-help' }],
    ['Esc', key.esc, { type: 'close-help' }],
    ['anything else', press('a'), none],
  ] as Array<[string, KeyPress, GateAction]>)('%s', (_label, pressed, expected) => {
    expect(resolveKey('help', pressed, ctx())).toEqual(expected);
  });
});

describe('the reject prompt', () => {
  it.each([
    ['y', press('y'), { type: 'answer-reject-prompt', confirm: true }],
    ['Y', press('Y'), { type: 'answer-reject-prompt', confirm: true }],
    ['n', press('n'), { type: 'answer-reject-prompt', confirm: false }],
    ['N', press('N'), { type: 'answer-reject-prompt', confirm: false }],
    ['Esc', key.esc, { type: 'answer-reject-prompt', confirm: false }],
    ['a key that is not an answer is ignored, so a stray press cannot accept or quit', press('a'), none],
    ['q does not quit while the prompt is open', press('q'), none],
  ] as Array<[string, KeyPress, GateAction]>)('%s', (_label, pressed, expected) => {
    expect(resolveKey('reject-prompt', pressed, ctx())).toEqual(expected);
  });
});

describe('search', () => {
  it.each([
    ['Esc', key.esc, { type: 'close-search' }],
    ['Enter', key.enter, { type: 'submit-search' }],
    ['text', press('x'), { type: 'search-input' }],
    ['q is typed, it does not quit', press('q'), { type: 'search-input' }],
  ] as Array<[string, KeyPress, GateAction]>)('%s', (_label, pressed, expected) => {
    expect(resolveKey('search', pressed, ctx())).toEqual(expected);
  });
});

describe('the cycles panel', () => {
  it.each([
    ['Esc', key.esc, { type: 'close-panel' }],
    ['c', press('c'), { type: 'close-panel' }],
    ['up', key.up, { type: 'move', delta: -1 }],
    ['down', key.down, { type: 'move', delta: 1 }],
    ['Enter', key.enter, { type: 'jump-to-selected' }],
    ['q does not quit', press('q'), none],
    ['a does not accept', press('a'), none],
  ] as Array<[string, KeyPress, GateAction]>)('%s', (_label, pressed, expected) => {
    expect(resolveKey('cycles', pressed, ctx())).toEqual(expected);
  });
});

describe('the flags panel', () => {
  it.each([
    ['up', key.up, { type: 'move', delta: -1 }],
    ['down', key.down, { type: 'move', delta: 1 }],
    ['Enter', key.enter, { type: 'jump-to-selected' }],
    ['q does not quit', press('q'), none],
  ] as Array<[string, KeyPress, GateAction]>)('%s', (_label, pressed, expected) => {
    expect(resolveKey('flags', pressed, ctx())).toEqual(expected);
  });
});

describe('the main keys', () => {
  const main = (pressed: KeyPress, context: Partial<GateContext> = {}): GateAction =>
    resolveKey('main', pressed, ctx(context));

  it.each([
    ['q', press('q'), { type: 'quit' }],
    ['Esc', key.esc, { type: 'quit' }],
    ['h', press('h'), { type: 'open-panel', panel: 'help' }],
    ['f', press('f'), { type: 'confirm' }],
    ['F', press('F'), { type: 'confirm' }],
    ['c', press('c'), { type: 'open-panel', panel: 'cycles' }],
    ['d', press('d'), { type: 'toggle-dependencies' }],
    ['x', press('x'), { type: 'open-panel', panel: 'flags' }],
    ['/', press('/'), { type: 'open-panel', panel: 'search' }],
    ['o', press('o'), { type: 'toggle-cycle-filter' }],
    ['i', press('i'), { type: 'toggle-jump-filter' }],
    ['space', press(' '), { type: 'toggle-group' }],
    ['E', press('E'), { type: 'expand-all' }],
    ['C', press('C'), { type: 'collapse-all' }],
    ['a', press('a'), { type: 'accept' }],
    ['r', press('r'), { type: 'reject' }],
    ['L', press('L'), { type: 'toggle-view' }],
    ['A', press('A'), { type: 'toggle-all' }],
    ['Y', press('Y'), { type: 'accept-unflagged' }],
    ['Tab', key.tab, { type: 'switch-column', delta: 1 }],
    ['Shift-Tab', key.shiftTab, { type: 'switch-column', delta: -1 }],
    ['up', key.up, { type: 'move', delta: -1 }],
    ['down', key.down, { type: 'move', delta: 1 }],
    ['an unknown key', press('z'), none],
  ] as Array<[string, KeyPress, GateAction]>)('%s', (_label, pressed, expected) => {
    expect(main(pressed)).toEqual(expected);
  });

  describe('Esc clears before it quits', () => {
    it('clears the jump filter first', () => {
      expect(main(key.esc, { jumpFilterActive: true })).toEqual({ type: 'clear-jump-filter' });
    });
    it('clears the search text next', () => {
      expect(main(key.esc, { searchActive: true })).toEqual({ type: 'clear-search' });
    });
    it('clears the jump filter before the search text when both are set', () => {
      expect(main(key.esc, { jumpFilterActive: true, searchActive: true })).toEqual({ type: 'clear-jump-filter' });
    });
    it('q still quits with a filter on', () => {
      expect(main(press('q'), { jumpFilterActive: true, searchActive: true })).toEqual({ type: 'quit' });
    });
  });

  describe('keys that need something to act on', () => {
    it('c and o do nothing without cycles', () => {
      expect(main(press('c'), { hasCycles: false })).toEqual(none);
      expect(main(press('o'), { hasCycles: false })).toEqual(none);
    });
    it('x does nothing without a flag to explain', () => {
      expect(main(press('x'), { hasFlagReasons: false })).toEqual(none);
    });
    it('the arrows do nothing on an empty list', () => {
      expect(main(key.up, { focusedListEmpty: true })).toEqual(none);
      expect(main(key.down, { focusedListEmpty: true })).toEqual(none);
    });
    it('Tab does nothing in a single column layout', () => {
      expect(main(key.tab, { singleColumn: true })).toEqual(none);
    });
    it('i with Ctrl is not the jump filter', () => {
      expect(main(press('i', { ctrl: true }))).toEqual(none);
    });
  });

  describe('in the added components column', () => {
    const added = { focusedColumn: 'added-components' } as const;
    it('r rejects the entry', () => {
      expect(main(press('r'), added)).toEqual({ type: 'reject' });
    });
    it('a does nothing', () => {
      expect(main(press('a'), added)).toEqual(none);
    });
    it('group keys do nothing', () => {
      for (const k of [' ', 'E', 'C']) expect(main(press(k), added)).toEqual(none);
    });
    it('Enter jumps to the entry in the main column', () => {
      expect(main(key.enter, added)).toEqual({ type: 'jump-to-selected' });
    });
    it('Enter does nothing in the main column', () => {
      expect(main(key.enter)).toEqual(none);
    });
    it('toggle all and accept non-flagged work from either column', () => {
      expect(main(press('A'), added)).toEqual({ type: 'toggle-all' });
      expect(main(press('Y'), added)).toEqual({ type: 'accept-unflagged' });
    });
  });
});

describe('every mode is covered', () => {
  it('has a branch for each mode', () => {
    const modes: GateMode[] = ['help', 'reject-prompt', 'search', 'cycles', 'flags', 'main'];
    for (const mode of modes) expect(() => resolveKey(mode, press('z'), ctx())).not.toThrow();
  });
});
