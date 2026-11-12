import { describe, expect, it } from 'vitest';
import {
  openReviewTrail,
  recordReviewAction,
  reviewFinish,
  reviewProgress,
} from '../../../src/tui/import/steps/09-review/review-log.js';
import type { CdfReviewEntry, ReviewComponentStatus } from '../../../src/tui/import/steps/09-review/types.js';

const entry = (key: string, status: ReviewComponentStatus): CdfReviewEntry =>
  ({ key, entry: {}, status }) as unknown as CdfReviewEntry;

// A component "goes missing" in the review when the user rejects it, or when they accept one the checks had rejected. What
// must hold is that the log says which components ended up somewhere other than where they arrived.
describe('the review debug log', () => {
  const arrived = [
    entry('Hero', 'needs-review'),
    entry('Card', 'rejected'),
    entry('Nav', 'accepted'),
    entry('Tag', 'reviewed'),
  ];

  it('names the components the user decided differently from how they arrived', () => {
    const trail = openReviewTrail(arrived, 0);
    recordReviewAction(trail, 'edit-save');
    recordReviewAction(trail, 'token-review:size');
    recordReviewAction(trail, 'undo');
    const ended = [
      entry('Hero', 'rejected'),
      entry('Card', 'accepted'),
      entry('Nav', 'accepted'),
      entry('Tag', 'reviewed'),
    ];

    const { outputs, exitMethod } = reviewFinish(trail, ended, 5000, { accepted: 2, rejected: 1, unresolved: 1 });

    expect(outputs['outcome']).toBe('finalized: 2 accepted, 1 rejected, 1 unresolved');
    expect(outputs['rejected_by_user']).toEqual({ count: 1, names: ['Hero'] });
    expect(outputs['accepted_by_user']).toEqual({ count: 1, names: ['Card'] });
    expect(outputs['edits']).toMatchObject({ total: 3, by_kind: { 'edit-save': 1, 'token-review': 1, undo: 1 } });
    expect(exitMethod).toBe('saved');
  });

  it('says so when the review was left without finishing, and when it was cut short', () => {
    const trail = openReviewTrail(arrived, 0);

    expect(reviewFinish(trail, arrived, 1000, undefined)).toMatchObject({
      outputs: { outcome: 'left the review without finishing' },
      exitMethod: 'discarded',
    });
    expect(reviewProgress(trail, arrived, 1000).outputs['outcome']).toBe('interrupted');
  });
});
