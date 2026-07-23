import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { ReviewComponentStatus } from '../../analyze/select/types.js';

export interface HistorySnapshot {
  components: CdfReviewEntrySnapshot[];
  autoRejected: string[];
  undoSnapshot: Map<string, ReviewComponentStatus> | null;
}

export interface CdfReviewEntrySnapshot {
  key: string;
  entry: CDFComponentEntry;
  status: ReviewComponentStatus;
}

export interface HistoryStack {
  push(snapshot: HistorySnapshot, label: string): void;
  undo(): HistorySnapshot | null;
  redo(): HistorySnapshot | null;
  canUndo(): boolean;
  canRedo(): boolean;
  reset(seed: HistorySnapshot): void;
  size(): number;
}

const DEFAULT_MAX_DEPTH = 50;

function cloneSnapshot(snap: HistorySnapshot): HistorySnapshot {
  return {
    components: snap.components.map((c) => ({
      key: c.key,
      entry: JSON.parse(JSON.stringify(c.entry)) as CDFComponentEntry,
      status: c.status,
    })),
    autoRejected: [...snap.autoRejected],
    undoSnapshot:
      snap.undoSnapshot === null
        ? null
        : new Map(Array.from(snap.undoSnapshot.entries())),
  };
}

export function createHistoryStack(
  seed: HistorySnapshot,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): HistoryStack {
  const cap = Math.max(1, maxDepth);
  let stack: HistorySnapshot[] = [cloneSnapshot(seed)];
  let cursor = 0;

  function push(snapshot: HistorySnapshot, _label: string): void {
    if (cursor < stack.length - 1) {
      stack = stack.slice(0, cursor + 1);
    }
    stack.push(cloneSnapshot(snapshot));
    while (stack.length > cap) {
      stack.shift();
    }
    cursor = stack.length - 1;
  }

  function undo(): HistorySnapshot | null {
    if (cursor <= 0) return null;
    cursor -= 1;
    return cloneSnapshot(stack[cursor]);
  }

  function redo(): HistorySnapshot | null {
    if (cursor >= stack.length - 1) return null;
    cursor += 1;
    return cloneSnapshot(stack[cursor]);
  }

  function canUndo(): boolean {
    return cursor > 0;
  }

  function canRedo(): boolean {
    return cursor < stack.length - 1;
  }

  function reset(nextSeed: HistorySnapshot): void {
    stack = [cloneSnapshot(nextSeed)];
    cursor = 0;
  }

  function size(): number {
    return stack.length;
  }

  return { push, undo, redo, canUndo, canRedo, reset, size };
}
