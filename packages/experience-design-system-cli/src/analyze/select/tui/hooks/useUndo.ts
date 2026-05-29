import { useState } from 'react';

export type UseUndoResult<T> = {
  current: T;
  push: (next: T) => void;
  undo: () => void;
  canUndo: boolean;
  clear: () => void;
};

export function useUndo<T>(initial: T, maxSize = 50): UseUndoResult<T> {
  const [stack, setStack] = useState<T[]>([]);
  const [current, setCurrent] = useState<T>(initial);

  return {
    current,
    push: (next: T) => {
      setStack((prev) => {
        const newStack = [...prev, current];
        return newStack.length > maxSize ? newStack.slice(1) : newStack;
      });
      setCurrent(next);
    },
    undo: () => {
      setStack((prev) => {
        if (prev.length === 0) return prev;
        const newStack = prev.slice(0, -1);
        setCurrent(prev[prev.length - 1]);
        return newStack;
      });
    },
    canUndo: stack.length > 0,
    clear: () => setStack([]),
  };
}
