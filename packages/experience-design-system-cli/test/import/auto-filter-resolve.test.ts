import { describe, it, expect } from 'vitest';
import { resolveAutoFilter } from '../../src/import/auto-filter-resolve.js';

describe('resolveAutoFilter', () => {
  describe('config preference', () => {
    it('config=true -> true', () => {
      expect(resolveAutoFilter(true)).toBe(true);
    });

    it('config=false -> false', () => {
      expect(resolveAutoFilter(false)).toBe(false);
    });
  });

  describe('default ON when config is absent', () => {
    it('config=undefined -> true', () => {
      expect(resolveAutoFilter(undefined)).toBe(true);
    });
  });
});
