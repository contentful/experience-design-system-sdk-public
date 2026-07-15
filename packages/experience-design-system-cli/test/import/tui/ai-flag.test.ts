import { describe, it, expect } from 'vitest';
import { isAiFlagged, isDefaultIncluded } from '../../../src/import/tui/ai-flag.js';

describe('ai-flag policy', () => {
  describe('isAiFlagged', () => {
    it('flags rejected rows', () => {
      expect(isAiFlagged({ aiDecision: 'rejected' })).toBe(true);
    });

    // INTEG-4318: 'failed' must be treated as flagged, not silently included.
    it('flags failed rows', () => {
      expect(isAiFlagged({ aiDecision: 'failed' })).toBe(true);
    });

    it('does not flag accepted rows', () => {
      expect(isAiFlagged({ aiDecision: 'accepted' })).toBe(false);
    });

    it('does not flag rows with a null or missing decision', () => {
      expect(isAiFlagged({ aiDecision: null })).toBe(false);
      expect(isAiFlagged({})).toBe(false);
    });
  });

  describe('isDefaultIncluded', () => {
    it('includes rows that are not flagged', () => {
      expect(isDefaultIncluded({ aiDecision: 'accepted' })).toBe(true);
      expect(isDefaultIncluded({})).toBe(true);
    });

    it('excludes flagged rows by default', () => {
      expect(isDefaultIncluded({ aiDecision: 'rejected' })).toBe(false);
      expect(isDefaultIncluded({ aiDecision: 'failed' })).toBe(false);
    });
  });
});
