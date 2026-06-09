import { useState } from 'react';

export type UseUndoResult<T> = {
  current: T;
  push: (next: T) => void;
  undo: () => void;
  canUndo: boolean;
  clear: () => void;
};

type UndoState<T> = { stack: T[]; current: T };

// Single-state implementation — push and undo are atomic single setState calls,
// eliminating the double-render that caused flash in the JsonEditor.
export function useUndo<T>(initial: T, maxSize = 50): UseUndoResult<T> {
  const [state, setState] = useState<UndoState<T>>({ stack: [], current: initial });

  return {
    current: state.current,
    push: (next: T) =>
      setState(({ stack, current }) => {
        const newStack = [...stack, current];
        return { stack: newStack.length > maxSize ? newStack.slice(1) : newStack, current: next };
      }),
    undo: () =>
      setState(({ stack, current }) => {
        if (stack.length === 0) return { stack, current };
        return { stack: stack.slice(0, -1), current: stack[stack.length - 1]! };
      }),
    canUndo: state.stack.length > 0,
    clear: () => setState(({ current }) => ({ stack: [], current })),
  };
}
