import { describe, expect, it } from 'vitest';
import { hasBreakingChangesWithImpact } from '../../src/helpers/has-breaking-changes.js';
import type { ServerPreviewResponse } from '../../../shared/index.js';

function makePreview(
  componentChanges: Array<{ classification?: string; affectedFragments?: number; affectedExperiences?: number }> = [],
  tokenChanges: Array<{ classification?: string; affectedFragments?: number; affectedExperiences?: number }> = [],
): ServerPreviewResponse {
  const toEntry = (c: { classification?: string; affectedFragments?: number; affectedExperiences?: number }) => ({
    changeClassification: c.classification ? { classification: c.classification } : undefined,
    impact:
      c.affectedFragments !== undefined || c.affectedExperiences !== undefined
        ? { affectedFragments: c.affectedFragments ?? 0, affectedExperiences: c.affectedExperiences ?? 0 }
        : undefined,
  });
  return {
    components: { changed: componentChanges.map(toEntry) },
    tokens: { changed: tokenChanges.map(toEntry) },
  } as unknown as ServerPreviewResponse;
}

describe('hasBreakingChangesWithImpact', () => {
  it('returns false when there are no changed items', () => {
    expect(hasBreakingChangesWithImpact(makePreview())).toBe(false);
  });

  it('returns false for a non-breaking change even with impact', () => {
    expect(hasBreakingChangesWithImpact(makePreview([{ classification: 'non-breaking', affectedFragments: 5 }]))).toBe(
      false,
    );
  });

  it('returns false for a breaking change with zero impact', () => {
    expect(
      hasBreakingChangesWithImpact(
        makePreview([{ classification: 'breaking', affectedFragments: 0, affectedExperiences: 0 }]),
      ),
    ).toBe(false);
  });

  it('returns true for a breaking change with affectedFragments > 0', () => {
    expect(hasBreakingChangesWithImpact(makePreview([{ classification: 'breaking', affectedFragments: 3 }]))).toBe(
      true,
    );
  });

  it('returns true for a breaking change with affectedExperiences > 0', () => {
    expect(
      hasBreakingChangesWithImpact(
        makePreview([{ classification: 'breaking', affectedFragments: 0, affectedExperiences: 1 }]),
      ),
    ).toBe(true);
  });

  it('detects breaking changes in tokens as well as components', () => {
    expect(hasBreakingChangesWithImpact(makePreview([], [{ classification: 'breaking', affectedFragments: 2 }]))).toBe(
      true,
    );
  });

  it('returns false when breaking change has no impact object', () => {
    const preview = {
      components: { changed: [{ changeClassification: { classification: 'breaking' } }] },
      tokens: { changed: [] },
    } as unknown as ServerPreviewResponse;
    expect(hasBreakingChangesWithImpact(preview)).toBe(false);
  });
});
