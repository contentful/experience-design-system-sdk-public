import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { ReviewComponentStatus } from '../../analyze/select/types.js';

/**
 * T4 (parity plan §3) — bounded undo/redo history stack for GenerateReviewStep.
 *
 * Undo is IN-MEMORY ONLY: restoring a prior snapshot never writes back to the
 * session DB. The escape hatch for "the DB is right, my in-memory is wrong" is
 * the `[Ctrl+R]` reload-from-save affordance, which re-runs the mount load path
 * and resets the history via `reset(seed)`.
 *
 * Semantics:
 *  - `push(snap, label)` appends after the current cursor, dropping any
 *    redo-tail (standard undo/redo behavior).
 *  - `undo()` moves the cursor back one and returns the snapshot at the new
 *    position (the previous state), or `null` when at the floor.
 *  - `redo()` moves the cursor forward and returns the snapshot at the new
 *    position, or `null` when at the top.
 *  - `reset(seed)` clears the stack and reinitializes with a single seed.
 *  - Bounded by `maxDepth` (default 50). On overflow, the oldest entry drops
 *    off the bottom; `undo()` therefore bottoms out one entry closer to the
 *    current cursor than an unbounded stack would.
 */
export interface HistorySnapshot {
  components: CdfReviewEntrySnapshot[];
  autoRejected: string[];
  undoSnapshot: Map<string, ReviewComponentStatus> | null;
}

/** Minimum shape we clone into the stack. Kept structurally identical to
 * `CdfReviewEntry` from the GenerateReview step so callers can pass their
 * state through without adapters. */
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
    // Drop the redo tail: anything after the cursor is invalidated.
    if (cursor < stack.length - 1) {
      stack = stack.slice(0, cursor + 1);
    }
    stack.push(cloneSnapshot(snapshot));
    // Overflow: drop from the bottom until we're within capacity.
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
