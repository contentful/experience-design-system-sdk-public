import { describe, expect, it } from 'vitest';
import { progressRows } from '../../../src/tui/import/steps/08-generation/logic.js';
import { lineState } from '../../../src/tui/import/shared/running-step/logic.js';
import type { GenerationProgress } from '../../../src/tui/import/steps/08-generation/types.js';

const progress = (components: GenerationProgress['components'], mapTokens: GenerationProgress['mapTokens'] = 'idle') =>
  ({ components, activity: [], mapTokens, mapTokensEligible: null }) satisfies GenerationProgress;

// A component that fails does not stop the run, which only fails at the end. What must hold is that the screen says so as
// it happens, and never shows a run with failures as a success.
describe('the generation rows', () => {
  it('shows a run going badly while it is still going', () => {
    const [row] = progressRows(progress({ done: 3, total: 10, current: 'Card', failed: 1 }), 'claude');

    expect(row).toMatchObject({ text: 'Card (1 failed so far)', progress: { done: 3, total: 10 }, state: 'warning' });
  });

  it('shows a finished run with failures as failed, not as generated', () => {
    const [row] = progressRows(progress({ done: 10, total: 10, current: 'Card', failed: 2 }), 'claude');

    expect(row).toMatchObject({ text: 'Generated 8 of 10 components, 2 failed' });
    expect(lineState(row!)).toBe('failed');
  });

  it('shows a clean run as generated once every component has been tried', () => {
    const [row] = progressRows(progress({ done: 10, total: 10, current: 'Card', failed: 0 }), 'claude');

    expect(row).toEqual({ text: 'Generated 10 components', complete: true });
  });

  it('keeps the bar and the current component while all is well', () => {
    const [row] = progressRows(progress({ done: 3, total: 10, current: 'Card', failed: 0 }), 'claude');

    expect(row).toEqual({ text: 'Card', complete: false, progress: { done: 3, total: 10 } });
  });

  it('adds how long a finished row took, by position', () => {
    const rows = progressRows(
      progress({ done: 2, total: 2, current: 'Card', failed: 0 }, 'running'),
      'claude',
      [90000],
    );

    expect(rows[0]).toMatchObject({ text: 'Generated 2 components', ms: 90000 });
    expect(rows[1]).toMatchObject({ text: 'Mapping token restrictions via Claude...' });
    expect(rows[1]).not.toHaveProperty('ms');
  });
});
