import { describe, it, expect } from 'vitest';
import { createHistoryStack, type HistorySnapshot } from '../../../src/import/tui/history.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { ReviewComponentStatus } from '../../../src/analyze/select/types.js';

const entry = (): CDFComponentEntry => ({
  $type: 'component',
  $properties: {},
});

const snap = (label: string, status: ReviewComponentStatus = 'needs-review'): HistorySnapshot => ({
  components: [{ key: label, entry: entry(), status }],
  autoRejected: [],
  undoSnapshot: null,
});

describe('createHistoryStack — T4 undo/redo primitive', () => {
  it('seed snapshot occupies the initial position; canUndo=false, canRedo=false', () => {
    const h = createHistoryStack(snap('S0'));
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(1);
  });

  it('push advances the cursor; undo returns the previous snapshot', () => {
    const h = createHistoryStack(snap('S0'));
    h.push(snap('S1'), 'push-1');
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    const restored = h.undo();
    expect(restored).not.toBeNull();
    expect(restored!.components[0].key).toBe('S0');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('redo moves forward after undo', () => {
    const h = createHistoryStack(snap('S0'));
    h.push(snap('S1'), 'p1');
    h.undo();
    const forward = h.redo();
    expect(forward).not.toBeNull();
    expect(forward!.components[0].key).toBe('S1');
    expect(h.canRedo()).toBe(false);
  });

  it('undo at floor returns null and does not move the cursor', () => {
    const h = createHistoryStack(snap('S0'));
    expect(h.undo()).toBeNull();
    expect(h.canRedo()).toBe(false);
  });

  it('redo at top returns null', () => {
    const h = createHistoryStack(snap('S0'));
    h.push(snap('S1'), 'p1');
    expect(h.redo()).toBeNull();
  });

  it('push after undo drops the redo-tail', () => {
    const h = createHistoryStack(snap('S0'));
    h.push(snap('S1'), 'p1');
    h.push(snap('S2'), 'p2');
    h.undo(); // cursor at S1
    h.push(snap('S3'), 'p3'); // drops S2, appends S3
    expect(h.canRedo()).toBe(false);
    const back = h.undo();
    expect(back!.components[0].key).toBe('S1');
    const forward = h.redo();
    expect(forward!.components[0].key).toBe('S3');
  });

  it('overflow drops oldest entries', () => {
    const h = createHistoryStack(snap('S0'), 3);
    h.push(snap('S1'), 'p1');
    h.push(snap('S2'), 'p2');
    h.push(snap('S3'), 'p3'); // triggers overflow → S0 dropped
    expect(h.size()).toBe(3);
    h.undo(); // → S2
    h.undo(); // → S1
    expect(h.canUndo()).toBe(false); // S0 was dropped
  });

  it('reset clears the stack and installs the new seed', () => {
    const h = createHistoryStack(snap('S0'));
    h.push(snap('S1'), 'p1');
    h.push(snap('S2'), 'p2');
    h.reset(snap('Fresh'));
    expect(h.size()).toBe(1);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('snapshots are structurally cloned (mutating original does not corrupt stack)', () => {
    const s = snap('S0');
    const h = createHistoryStack(s);
    // Mutate original AFTER seed.
    s.components[0].status = 'accepted';
    s.autoRejected.push('X');
    const restored = h.undo() ?? (h.redo() as HistorySnapshot);
    // The stack's seed should still reflect the ORIGINAL state (needs-review, no autoRejected).
    // (undo returns null at floor; use the peek via a push+undo cycle.)
    h.push(snap('S1'), 'p1');
    const back = h.undo();
    expect(back!.components[0].status).toBe('needs-review');
    expect(back!.autoRejected).toEqual([]);
    void restored;
  });

  it('undoSnapshot Map is cloned (independent instance)', () => {
    const initial: HistorySnapshot = {
      components: [{ key: 'A', entry: entry(), status: 'needs-review' }],
      autoRejected: ['A'],
      undoSnapshot: new Map([['A', 'needs-review' as ReviewComponentStatus]]),
    };
    const h = createHistoryStack(initial);
    h.push(
      {
        components: [{ key: 'A', entry: entry(), status: 'rejected' }],
        autoRejected: ['A'],
        undoSnapshot: null,
      },
      'p1',
    );
    const back = h.undo()!;
    expect(back.undoSnapshot).not.toBeNull();
    expect(back.undoSnapshot!.get('A')).toBe('needs-review');
    // Mutating the returned Map should not corrupt the stack.
    back.undoSnapshot!.set('A', 'accepted');
    h.push(
      {
        components: [{ key: 'A', entry: entry(), status: 'accepted' }],
        autoRejected: [],
        undoSnapshot: null,
      },
      'p2',
    );
    const backAgain = h.undo()!;
    // Original snapshot still has its Map intact.
    expect(backAgain.undoSnapshot).not.toBeNull();
    expect(backAgain.undoSnapshot!.get('A')).toBe('needs-review');
  });
});
