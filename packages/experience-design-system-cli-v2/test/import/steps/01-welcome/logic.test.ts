import { describe, expect, it } from 'vitest';
import type { LineKey } from '../../../../src/tui/import/input/line-editing.js';
import { reducePathInput } from '../../../../src/tui/import/steps/01-welcome/logic.js';

const NO_KEY: LineKey = { return: false, escape: false, backspace: false, delete: false, ctrl: false, meta: false };

function key(overrides: Partial<LineKey>): LineKey {
  return { ...NO_KEY, ...overrides };
}

describe('reducePathInput', () => {
  it('turns typed characters into an edit', () => {
    expect(reducePathInput('./sr', 'c', NO_KEY)).toEqual({ type: 'edit', value: './src' });
  });

  it('quits on escape, even with text in the field', () => {
    expect(reducePathInput('./src', '', key({ escape: true }))).toEqual({ type: 'quit' });
  });

  it('quits on q while the field is empty', () => {
    expect(reducePathInput('', 'q', NO_KEY)).toEqual({ type: 'quit' });
  });

  it('types q as a letter once the field has text, so paths like components/quiz work', () => {
    expect(reducePathInput('components/', 'q', NO_KEY)).toEqual({ type: 'edit', value: 'components/q' });
  });

  it('does not quit on ctrl+q or meta+q from an empty field', () => {
    expect(reducePathInput('', 'q', key({ ctrl: true }))).toEqual({ type: 'ignore' });
    expect(reducePathInput('', 'q', key({ meta: true }))).toEqual({ type: 'ignore' });
  });

  it('submits the trimmed path on enter', () => {
    expect(reducePathInput('  ./src  ', '', key({ return: true }))).toEqual({
      type: 'submit',
      projectPath: './src',
    });
  });

  it('ignores enter on an empty or whitespace-only field', () => {
    expect(reducePathInput('', '', key({ return: true }))).toEqual({ type: 'ignore' });
    expect(reducePathInput('   ', '', key({ return: true }))).toEqual({ type: 'ignore' });
  });

  it('trims the last character on backspace', () => {
    expect(reducePathInput('./src', '', key({ backspace: true }))).toEqual({ type: 'edit', value: './sr' });
  });
});
