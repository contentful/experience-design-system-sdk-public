import { applyLineKey, type LineKey } from '../../input/line-editing.js';

/** What a single key press means for the project-path field. The screen turns each variant into a state update or callback. */
export type PathInputEvent =
  | { type: 'edit'; value: string }
  | { type: 'submit'; projectPath: string }
  | { type: 'quit' }
  | { type: 'ignore' };

/**
 * Decide what one key press means given the current text.
 * Esc always quits. `q` quits only while the field is empty, so a path such as `components/quiz` can still be typed.
 * Enter submits the trimmed path, but not a blank one.
 */
export function reducePathInput(value: string, input: string, key: LineKey): PathInputEvent {
  if (value === '' && input === 'q' && !key.ctrl && !key.meta) return { type: 'quit' };

  const edit = applyLineKey(value, input, key);
  switch (edit.type) {
    case 'change':
      return { type: 'edit', value: edit.value };
    case 'cancel':
      return { type: 'quit' };
    case 'submit': {
      const projectPath = value.trim();
      return projectPath ? { type: 'submit', projectPath } : { type: 'ignore' };
    }
    case 'ignore':
      return { type: 'ignore' };
  }
}
