import { describe, expect, it } from 'vitest';
import {
  nextStepAfterScopeGate,
  nextStepAfterCredentialsValidated,
} from '../../../src/import/tui/wizard-state-transitions.js';

describe('nextStepAfterScopeGate', () => {
  it('routes to credentials when accepted > 0 and push is enabled', () => {
    expect(nextStepAfterScopeGate({ acceptedCount: 5, noPush: false })).toBe('credentials');
  });

  it('routes directly to generating when accepted > 0 and --no-push is set (skips credentials)', () => {
    expect(nextStepAfterScopeGate({ acceptedCount: 5, noPush: true })).toBe('generating');
  });

  it('routes to credentials when accepted === 0 and push is enabled (still need creds for tokens/removals)', () => {
    expect(nextStepAfterScopeGate({ acceptedCount: 0, noPush: false })).toBe('credentials');
  });

  it('routes to print-gate when accepted === 0 and --no-push is set (nothing to do; let operator save files)', () => {
    expect(nextStepAfterScopeGate({ acceptedCount: 0, noPush: true })).toBe('print-gate');
  });
});

describe('nextStepAfterCredentialsValidated', () => {
  it('routes to generating when there are accepted components to classify', () => {
    expect(nextStepAfterCredentialsValidated({ acceptedCount: 3 })).toBe('generating');
  });

  it('routes to push-decision-gate when no components were accepted (skip generating + final-review)', () => {
    expect(nextStepAfterCredentialsValidated({ acceptedCount: 0 })).toBe('push-decision-gate');
  });
});

describe('inline-validation flow — no transition targets "validating-credentials"', () => {
  // Pin: after the wizard prefetch refactor, `validating-credentials` is no
  // longer a render target — the credentials screen owns its own inline
  // loading state via the `validating` prop. The state-machine helpers must
  // never return that string (any future regression that re-introduces it
  // would silently restore the dropped dedicated render screen).
  it('nextStepAfterScopeGate never returns "validating-credentials"', () => {
    for (const acceptedCount of [0, 1, 5]) {
      for (const noPush of [false, true]) {
        const next = nextStepAfterScopeGate({ acceptedCount, noPush });
        expect(next).not.toBe('validating-credentials');
      }
    }
  });

  it('nextStepAfterCredentialsValidated never returns "validating-credentials"', () => {
    for (const acceptedCount of [0, 1, 5]) {
      const next = nextStepAfterCredentialsValidated({ acceptedCount });
      expect(next).not.toBe('validating-credentials');
    }
  });
});
