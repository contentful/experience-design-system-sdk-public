import { describe, expect, it } from 'vitest';
import { applyLineKey, withCursor, type LineKey } from '../../../src/tui/import/input/line-editing.js';

const NO_KEY: LineKey = { return: false, escape: false, backspace: false, delete: false, ctrl: false, meta: false };

function key(overrides: Partial<LineKey>): LineKey {
  return { ...NO_KEY, ...overrides };
}

describe('applyLineKey', () => {
  it('appends printable input to the value', () => {
    expect(applyLineKey('ab', 'c', NO_KEY)).toEqual({ type: 'change', value: 'abc' });
  });

  it('appends a whole pasted chunk in one edit', () => {
    expect(applyLineKey('', './src/components', NO_KEY)).toEqual({ type: 'change', value: './src/components' });
  });

  it('removes the last character on backspace', () => {
    expect(applyLineKey('abc', '', key({ backspace: true }))).toEqual({ type: 'change', value: 'ab' });
  });

  it('treats delete like backspace, since many terminals report backspace as delete', () => {
    expect(applyLineKey('abc', '', key({ delete: true }))).toEqual({ type: 'change', value: 'ab' });
  });

  it('ignores backspace on an empty value', () => {
    expect(applyLineKey('', '', key({ backspace: true }))).toEqual({ type: 'ignore' });
  });

  it('reports submit on return without touching the value', () => {
    expect(applyLineKey('abc', '', key({ return: true }))).toEqual({ type: 'submit' });
  });

  it('reports cancel on escape', () => {
    expect(applyLineKey('abc', '', key({ escape: true }))).toEqual({ type: 'cancel' });
  });

  it('ignores keys that carry no text, such as arrows and tab', () => {
    expect(applyLineKey('abc', '', NO_KEY)).toEqual({ type: 'ignore' });
  });

  it('ignores ctrl and meta combinations instead of typing them', () => {
    expect(applyLineKey('abc', 'a', key({ ctrl: true }))).toEqual({ type: 'ignore' });
    expect(applyLineKey('abc', 'a', key({ meta: true }))).toEqual({ type: 'ignore' });
  });
});

describe('withCursor', () => {
  it('appends a block cursor while it is visible', () => {
    expect(withCursor('abc', true)).toBe('abc█');
  });

  it('appends a space of the same width while the cursor is hidden, so the line does not jump', () => {
    expect(withCursor('abc', false)).toBe('abc ');
  });
});
