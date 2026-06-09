import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { JsonEditor } from '../../../../src/analyze/select/tui/components/JsonEditor.js';
import { applyEditorKey } from '../../../../src/analyze/select/tui/state.js';
import type { EditorState } from '../../../../src/analyze/select/tui/state.js';

const noKey = {
  ctrl: false,
  meta: false,
  return: false,
  backspace: false,
  delete: false,
  escape: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
};

function makeEditor(value: string): EditorState {
  return {
    cursor: { lines: value.split('\n'), cursorRow: 0, cursorCol: 0 },
    undoStack: [],
    scrollRow: 0,
    validationError: null,
  };
}

describe('JsonEditor (pure render)', () => {
  it('renders the initial value', () => {
    const editorState = makeEditor('{\n  "name": "Button"\n}');
    const { lastFrame } = render(<JsonEditor editorState={editorState} width={60} height={10} />);
    expect(lastFrame()).toContain('"name"');
  });

  it('renders validation error when set', () => {
    const editorState: EditorState = { ...makeEditor('bad json'), validationError: 'Invalid JSON: unexpected token' };
    const { lastFrame } = render(<JsonEditor editorState={editorState} width={60} height={10} />);
    expect(lastFrame()).toContain('Invalid JSON');
  });
});

describe('applyEditorKey (pure function)', () => {
  it('inserts a printable character', () => {
    const e = makeEditor('{}');
    // Move cursor right past '{' then type 'x'
    const moved = applyEditorKey(e, '', { ...noKey, rightArrow: true }, 20)!;
    const typed = applyEditorKey(moved, 'x', noKey, 20)!;
    expect(typed.cursor.lines[0]).toBe('{x}');
    expect(typed.cursor.cursorCol).toBe(2);
  });

  it('inserts newline on Enter', () => {
    const e = makeEditor('{"a":1}');
    const next = applyEditorKey(e, '', { ...noKey, return: true }, 20)!;
    expect(next.cursor.lines.length).toBe(2);
    expect(next.cursor.lines[0]).toBe('');
    expect(next.cursor.cursorRow).toBe(1);
  });

  it('deletes character before cursor on Backspace', () => {
    const e = makeEditor('ab');
    const moved = applyEditorKey(e, '', { ...noKey, rightArrow: true }, 20)!;
    const deleted = applyEditorKey(moved, '', { ...noKey, backspace: true }, 20)!;
    expect(deleted.cursor.lines[0]).toBe('b');
    expect(deleted.cursor.cursorCol).toBe(0);
  });

  it('moves cursor left', () => {
    const e = makeEditor('abc');
    const moved = applyEditorKey(e, '', { ...noKey, rightArrow: true }, 20)!;
    const back = applyEditorKey(moved, '', { ...noKey, leftArrow: true }, 20)!;
    expect(back.cursor.cursorCol).toBe(0);
  });

  it('moves cursor up', () => {
    const e = makeEditor('line1\nline2');
    const down = applyEditorKey(e, '', { ...noKey, downArrow: true }, 20)!;
    expect(down.cursor.cursorRow).toBe(1);
    const up = applyEditorKey(down, '', { ...noKey, upArrow: true }, 20)!;
    expect(up.cursor.cursorRow).toBe(0);
  });

  it('undoes last change', () => {
    const e = makeEditor('ab');
    const typed = applyEditorKey(e, 'x', noKey, 20)!;
    expect(typed.cursor.lines[0]).toBe('xab');
    const undone = applyEditorKey(typed, 'z', { ...noKey, ctrl: true }, 20)!;
    expect(undone.cursor.lines[0]).toBe('ab');
  });

  it('returns null when no movement possible (up at top)', () => {
    const e = makeEditor('single line');
    expect(applyEditorKey(e, '', { ...noKey, upArrow: true }, 20)).toBeNull();
  });

  it('syncs scroll when cursor goes below visible area', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    let e = makeEditor(lines);
    // Move cursor to row 25
    for (let i = 0; i < 25; i++) {
      e = applyEditorKey(e, '', { ...noKey, downArrow: true }, 10)!;
    }
    expect(e.scrollRow).toBeGreaterThan(0);
    expect(e.cursor.cursorRow).toBeLessThan(e.scrollRow + 10);
  });
});
