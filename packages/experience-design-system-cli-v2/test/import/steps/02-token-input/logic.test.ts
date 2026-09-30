import { describe, expect, it } from 'vitest';
import type { LineKey } from '../../../../src/tui/import/input/line-editing.js';
import {
  INITIAL_TOKEN_INPUT_STATE,
  reduceTokenInput,
  rejectPath,
  type TokenInputState,
} from '../../../../src/tui/import/steps/02-token-input/logic.js';

const NO_KEY: LineKey = { return: false, escape: false, backspace: false, delete: false, ctrl: false, meta: false };

function key(overrides: Partial<LineKey>): LineKey {
  return { ...NO_KEY, ...overrides };
}

function typed(value: string): TokenInputState {
  return { value, failure: null };
}

describe('reduceTokenInput', () => {
  it('appends typed characters', () => {
    expect(reduceTokenInput(typed('~/to'), 'k', NO_KEY)).toEqual({ state: typed('~/tok') });
  });

  it('skips on s while the field is empty', () => {
    expect(reduceTokenInput(INITIAL_TOKEN_INPUT_STATE, 's', NO_KEY).action).toEqual({ type: 'skip' });
  });

  it('quits on q while the field is empty', () => {
    expect(reduceTokenInput(INITIAL_TOKEN_INPUT_STATE, 'q', NO_KEY).action).toEqual({ type: 'quit' });
  });

  it('types s and q as letters once there is text, so ~/styles/quiz.json can be entered', () => {
    expect(reduceTokenInput(typed('~/'), 's', NO_KEY)).toEqual({ state: typed('~/s') });
    expect(reduceTokenInput(typed('~/'), 'q', NO_KEY)).toEqual({ state: typed('~/q') });
  });

  it('treats s and q as shortcuts again after backspacing to empty', () => {
    const afterBackspace = reduceTokenInput(typed('a'), '', key({ backspace: true })).state;

    expect(afterBackspace).toEqual(typed(''));
    expect(reduceTokenInput(afterBackspace, 's', NO_KEY).action).toEqual({ type: 'skip' });
  });

  it('does not treat ctrl+s or meta+q as shortcuts', () => {
    expect(reduceTokenInput(INITIAL_TOKEN_INPUT_STATE, 's', key({ ctrl: true })).action).toBeUndefined();
    expect(reduceTokenInput(INITIAL_TOKEN_INPUT_STATE, 'q', key({ meta: true })).action).toBeUndefined();
  });

  it('quits on escape, with or without text', () => {
    expect(reduceTokenInput(INITIAL_TOKEN_INPUT_STATE, '', key({ escape: true })).action).toEqual({ type: 'quit' });
    expect(reduceTokenInput(typed('~/tok'), '', key({ escape: true })).action).toEqual({ type: 'quit' });
  });

  it('asks the caller to submit the trimmed text on enter', () => {
    expect(reduceTokenInput(typed('  ~/tokens.json  '), '', key({ return: true })).action).toEqual({
      type: 'submit',
      rawPath: '~/tokens.json',
    });
  });

  it('skips on enter when the field is empty or only whitespace', () => {
    expect(reduceTokenInput(INITIAL_TOKEN_INPUT_STATE, '', key({ return: true })).action).toEqual({ type: 'skip' });
    expect(reduceTokenInput(typed('   '), '', key({ return: true })).action).toEqual({ type: 'skip' });
  });

  it('clears a previous rejection as soon as the text is edited', () => {
    const rejected = rejectPath(typed('~/nope'), { error: 'Path not found: /x', resolvedPath: '/x' });

    expect(reduceTokenInput(rejected, '!', NO_KEY).state.failure).toBeNull();
    expect(reduceTokenInput(rejected, '', key({ backspace: true })).state.failure).toBeNull();
  });
});

describe('rejectPath', () => {
  it('records the failure without touching the text', () => {
    const failure = { error: 'Path not found: /x', resolvedPath: '/x' };

    expect(rejectPath(typed('/x'), failure)).toEqual({ value: '/x', failure });
  });
});
