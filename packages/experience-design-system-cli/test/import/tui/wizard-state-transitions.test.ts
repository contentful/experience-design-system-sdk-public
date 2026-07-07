import { describe, expect, it } from 'vitest';
import {
  nextStepAfterScopeGate,
  nextStepAfterCredentialsValidated,
  shouldSkipFinalReviewAfterCredentials,
  resolveNoCacheForGenerate,
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

describe('shouldSkipFinalReviewAfterCredentials', () => {
  it('does NOT skip final-review when the operator has not yet finalized (prefetch completed early)', () => {
    expect(shouldSkipFinalReviewAfterCredentials({ generateSessionId: 'gen-abc', finalReviewPassed: false })).toBe(
      false,
    );
  });

  it('skips final-review when the operator already passed through it once (late 401 re-entry)', () => {
    expect(shouldSkipFinalReviewAfterCredentials({ generateSessionId: 'gen-abc', finalReviewPassed: true })).toBe(true);
  });

  it('never skips before the generate session exists', () => {
    expect(shouldSkipFinalReviewAfterCredentials({ generateSessionId: null, finalReviewPassed: false })).toBe(false);
    expect(shouldSkipFinalReviewAfterCredentials({ generateSessionId: null, finalReviewPassed: true })).toBe(false);
  });

  it('modify-entry / push-from-picker seed states short-circuit on re-entry', () => {
    expect(shouldSkipFinalReviewAfterCredentials({ generateSessionId: 'seeded-gen', finalReviewPassed: true })).toBe(
      true,
    );
  });
});

describe('resolveNoCacheForGenerate', () => {
  it('forces --no-cache on a fresh session even when the CLI did not pass --no-cache', () => {
    expect(resolveNoCacheForGenerate({ isFreshSession: true, cliNoCache: false })).toBe(true);
  });

  it('forces --no-cache on a fresh session when --no-cache was also passed', () => {
    expect(resolveNoCacheForGenerate({ isFreshSession: true, cliNoCache: true })).toBe(true);
  });

  it('honors the CLI flag on continued sessions — cache-on by default', () => {
    expect(resolveNoCacheForGenerate({ isFreshSession: false, cliNoCache: false })).toBe(false);
  });

  it('honors --no-cache on continued sessions when explicitly opted in', () => {
    expect(resolveNoCacheForGenerate({ isFreshSession: false, cliNoCache: true })).toBe(true);
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
