import { describe, expect, it } from 'vitest';
import { foldSvelteAndMdIntoOther } from '../../../../src/tui/import/steps/03-path-validation/helpers/fold-svelte-and-md-into-other.js';

describe('foldSvelteAndMdIntoOther', () => {
  it('adds svelte and md counts into other and keeps everything else as-is', () => {
    expect(
      foldSvelteAndMdIntoOther({
        tsx: 10,
        ts: 4,
        vue: 2,
        astro: 1,
        jsx: 0,
        js: 3,
        json: 5,
        svelte: 6,
        md: 2,
        other: 1,
        total: 34,
      }),
    ).toEqual({
      tsx: 10,
      ts: 4,
      vue: 2,
      astro: 1,
      jsx: 0,
      js: 3,
      json: 5,
      other: 9,
      total: 34,
    });
  });

  it('does not change other when there are no svelte or md files', () => {
    expect(
      foldSvelteAndMdIntoOther({
        tsx: 1,
        ts: 0,
        vue: 0,
        astro: 0,
        jsx: 0,
        js: 0,
        json: 0,
        svelte: 0,
        md: 0,
        other: 1,
        total: 2,
      }).other,
    ).toBe(1);
  });
});
