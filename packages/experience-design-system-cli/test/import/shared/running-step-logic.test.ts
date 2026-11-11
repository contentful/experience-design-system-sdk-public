import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  lineState,
  trackFinished,
  withTimes,
} from '../../../src/tui/import/shared/running-step/logic.js';

const running = { text: 'x', complete: false };
const done = { text: 'x', complete: true };

describe('lineState', () => {
  // A row that ended badly must never look like it is still running or like it worked.
  it('never shows a failed row as running or a warning as done', () => {
    expect(lineState({ text: 'x', complete: false, state: 'failed' })).toBe('failed');
    expect(lineState({ text: 'x', complete: true, state: 'warning' })).toBe('warning');
  });

  it('falls back to whether the row is complete', () => {
    expect(lineState(done)).toBe('done');
    expect(lineState(running)).toBe('running');
    expect(lineState({ text: 'x' })).toBe('running');
  });
});

describe('trackFinished', () => {
  it('notes a row the first time it is seen finished, and never changes it after', () => {
    const first = trackFinished([], [done, running], 2000);
    const later = trackFinished(first, [done, done], 9000);

    expect(first).toEqual([2000, undefined]);
    expect(later).toEqual([2000, 9000]);
  });

  it('counts a failed or warning row as finished, so its time stops', () => {
    expect(trackFinished([], [{ text: 'x', complete: false, state: 'failed' }], 4000)).toEqual([4000]);
    expect(trackFinished([], [{ text: 'x', complete: true, state: 'warning' }], 5000)).toEqual([5000]);
  });

  it('keeps timing a warning row that is still running, and stops once it has ended', () => {
    const running = { text: 'x', complete: false, state: 'warning' as const };

    expect(trackFinished([], [running], 4000)).toEqual([undefined]);
    expect(trackFinished([], [{ ...running, complete: true }], 4000)).toEqual([4000]);
  });

  it('adds a row that appears later at the end without moving the others', () => {
    expect(trackFinished([2000], [done, done], 7000)).toEqual([2000, 7000]);
  });
});

describe('withTimes and formatDuration', () => {
  it('puts a time on the rows that have one and leaves the rest alone', () => {
    const rows = withTimes([done, running], [3000]);

    expect(rows[0]).toMatchObject({ ms: 3000 });
    expect(rows[1]).not.toHaveProperty('ms');
  });

  it('says less than a second rather than 0s', () => {
    expect(formatDuration(400)).toBe('<1s');
    expect(formatDuration(2300)).toBe('2s');
    expect(formatDuration(83000)).toBe('1m 23s');
  });
});
