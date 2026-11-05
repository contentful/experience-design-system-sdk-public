import { describe, expect, it } from 'vitest';
import {
  panelLayout,
  truncate,
  visibleActivity,
  type ActivityItem,
} from '../../../src/tui/import/shared/running-step/activity.js';

const done = (name: string): ActivityItem => ({ name, state: 'done' });
const failed = (name: string): ActivityItem => ({ name, state: 'failed', error: 'boom' });
const running = (name: string): ActivityItem => ({ name, state: 'running' });

// A long run has far more entries than the panel has lines. What must hold is that a failure is never pushed out of view
// by the entries that came after it.
describe('visibleActivity', () => {
  it('shows everything when it fits', () => {
    const items = [done('a'), failed('b'), running('c')];

    expect(visibleActivity(items, 8)).toEqual({ shown: items, hidden: 0 });
  });

  it('keeps a failure on screen however many entries come after it', () => {
    const items = [failed('early'), ...Array.from({ length: 30 }, (_, i) => done(`later-${i}`))];

    const { shown, hidden } = visibleActivity(items, 6);

    expect(shown.map((item) => item.name)).toContain('early');
    expect(shown).toHaveLength(6);
    expect(hidden).toBe(items.length - 6);
  });

  it('keeps what is running now, then the newest finished entries, in the order they happened', () => {
    const items = [done('a'), done('b'), running('c'), done('d'), done('e'), done('f')];

    const { shown } = visibleActivity(items, 3);

    expect(shown.map((item) => item.name)).toEqual(['c', 'e', 'f']);
  });
});

describe('the panel layout', () => {
  it('goes beside the step on a wide terminal and under it on a narrow one', () => {
    expect(panelLayout(140)).toBe('beside');
    expect(panelLayout(110)).toBe('beside');
    expect(panelLayout(109)).toBe('below');
    expect(panelLayout(80)).toBe('below');
  });

  it('shortens a long line with an ellipsis and leaves a short one alone', () => {
    expect(truncate('abcdefghij', 6)).toBe('abcde…');
    expect(truncate('abc', 6)).toBe('abc');
  });
});
