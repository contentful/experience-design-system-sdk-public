import { describe, expect, it } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { createReviewHistorySnapshot } from '../../../src/tui/import/steps/09-review/session.js';
import type { CdfReviewEntry, ReviewComponentStatus } from '../../../src/tui/import/steps/09-review/types.js';

const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const review = (key: string, status: CdfReviewEntry['status']): CdfReviewEntry => ({ key, entry, status });

describe('review history', () => {
  describe('createReviewHistorySnapshot', () => {
    it('copies the components, with no auto-rejected and no undo snapshot by default', () => {
      expect(createReviewHistorySnapshot([review('A', 'accepted')])).toEqual({
        components: [{ key: 'A', entry, status: 'accepted' }],
        autoRejected: [],
        undoSnapshot: null,
      });
    });

    it('copies the undo snapshot instead of sharing it', () => {
      const undo = new Map<string, ReviewComponentStatus>([['A', 'accepted']]);
      const snapshot = createReviewHistorySnapshot([review('A', 'rejected')], {
        autoRejected: ['B'],
        undoSnapshot: undo,
      });
      undo.set('C', 'rejected');

      expect(snapshot.autoRejected).toEqual(['B']);
      expect([...snapshot.undoSnapshot!]).toEqual([['A', 'accepted']]);
    });

    it('treats a null undo snapshot as none', () => {
      expect(createReviewHistorySnapshot([], { undoSnapshot: null }).undoSnapshot).toBeNull();
    });
  });
});
