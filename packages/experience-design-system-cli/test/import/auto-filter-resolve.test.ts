import { describe, it, expect } from 'vitest';
import { resolveAutoFilter } from '../../src/import/auto-filter-resolve.js';

describe('resolveAutoFilter', () => {
  describe('flag wins over config', () => {
    it('flag=true overrides config=false', () => {
      expect(resolveAutoFilter({ autoFilter: true }, false)).toBe(true);
    });

    it('flag=true overrides config=true', () => {
      expect(resolveAutoFilter({ autoFilter: true }, true)).toBe(true);
    });

    it('flag=true overrides config=undefined', () => {
      expect(resolveAutoFilter({ autoFilter: true }, undefined)).toBe(true);
    });

    it('flag=false overrides config=true', () => {
      expect(resolveAutoFilter({ autoFilter: false }, true)).toBe(false);
    });

    it('flag=false overrides config=false', () => {
      expect(resolveAutoFilter({ autoFilter: false }, false)).toBe(false);
    });

    it('flag=false overrides config=undefined', () => {
      expect(resolveAutoFilter({ autoFilter: false }, undefined)).toBe(false);
    });
  });

  describe('config used when flag absent', () => {
    it('flag=undefined + config=true -> true', () => {
      expect(resolveAutoFilter({}, true)).toBe(true);
    });

    it('flag=undefined + config=false -> false', () => {
      expect(resolveAutoFilter({}, false)).toBe(false);
    });
  });

  describe('default ON when neither set', () => {
    it('flag=undefined + config=undefined -> true', () => {
      expect(resolveAutoFilter({}, undefined)).toBe(true);
    });
  });
});
