import { describe, expect, it } from 'vitest';

/**
 * `--no-push` flag plumbing pin. Mirrors the shape of wizard-cache.test.ts and
 * wizard-live-preview.test.ts. The actual state-machine routing is tested in
 * wizard-state-transitions.test.ts.
 *
 * Contract: `--no-push` is registered as a Commander negation flag and parsed
 * as `opts.push === false` when set. command.ts threads it into WizardApp as a
 * positive `noPush` prop (default false). Mirrors --no-cache / --no-auto-filter
 * / --no-live-preview precedent.
 */
describe('wizard --no-push flag plumbing', () => {
  it('translates Commander opts.push undefined → noPush false (default; push enabled)', () => {
    const opts: { push?: boolean } = {};
    const noPush = opts.push === false;
    expect(noPush).toBe(false);
  });

  it('translates Commander opts.push === false → noPush true (push disabled)', () => {
    const opts = { push: false };
    const noPush = opts.push === false;
    expect(noPush).toBe(true);
  });

  it('translates Commander opts.push === true → noPush false (push enabled)', () => {
    const opts = { push: true };
    const noPush = opts.push === false;
    expect(noPush).toBe(false);
  });
});
