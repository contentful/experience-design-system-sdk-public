/** The subset of a key press that single-line editing cares about. Ink's `Key` satisfies it. */
export interface LineKey {
  return: boolean;
  escape: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  meta: boolean;
}

/** What one key press means for a single-line text field. The caller turns each variant into a state update or callback. */
export type LineEdit = { type: 'change'; value: string } | { type: 'submit' } | { type: 'cancel' } | { type: 'ignore' };

const CURSOR = '█';

/**
 * Interpret one key press against the current text. Printable input (including a pasted chunk) appends,
 * backspace and delete both trim the last character (terminals disagree on which one they send),
 * Enter submits and Esc cancels. Anything else, including ctrl/meta combinations, is ignored.
 */
export function applyLineKey(value: string, input: string, key: LineKey): LineEdit {
  if (key.return) return { type: 'submit' };
  if (key.escape) return { type: 'cancel' };
  if (key.backspace || key.delete) {
    return value.length > 0 ? { type: 'change', value: value.slice(0, -1) } : { type: 'ignore' };
  }
  if (key.ctrl || key.meta || input === '') return { type: 'ignore' };
  return { type: 'change', value: value + input };
}

/** The text with a trailing block cursor, or a same-width space in the hidden blink phase so the line does not jump. */
export function withCursor(value: string, cursorVisible: boolean): string {
  return value + (cursorVisible ? CURSOR : ' ');
}
