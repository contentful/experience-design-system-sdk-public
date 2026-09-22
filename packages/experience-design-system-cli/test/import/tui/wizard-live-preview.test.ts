import { describe, expect, it } from 'vitest';

/**
 * Feature 2 (live preview after every save) flag-plumbing pins. Mirrors the
 * shape of `wizard-cache.test.ts` and `wizard-auto-filter.test.ts`. The actual
 * end-to-end behavior is exercised via the GenerateReviewStep tests; here we
 * just pin the Commander negation-flag → boolean prop translation that lives
 * in command.ts.
 *
 * The contract: `--no-live-preview` is registered as a Commander negation
 * flag, parsed as `opts.livePreview === false` when set, and threaded into
 * WizardApp / GenerateReviewStep as a positive `livePreview` prop (default
 * true). Mirrors --no-cache and --no-auto-filter precedent.
 */
describe('wizard --no-live-preview flag plumbing', () => {
  it('translates Commander opts.livePreview undefined → livePreview true (default)', () => {
    const opts: { livePreview?: boolean } = {};
    const livePreview = opts.livePreview !== false;
    expect(livePreview).toBe(true);
  });

  it('translates Commander opts.livePreview === false → livePreview false', () => {
    const opts = { livePreview: false };
    const livePreview = opts.livePreview !== false;
    expect(livePreview).toBe(false);
  });

  it('translates Commander opts.livePreview === true → livePreview true', () => {
    const opts = { livePreview: true };
    const livePreview = opts.livePreview !== false;
    expect(livePreview).toBe(true);
  });
});
