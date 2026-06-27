import { describe, expect, it } from 'vitest';
import { shouldRefusePush, buildSkippedPushTransition } from '../../../src/import/tui/wizard-state-transitions.js';

/**
 * Skip-credentials spec — Task 4. Defensive guard: even if the wizard's
 * state-machine bug-routed an operator into `runPush` after skipping
 * credentials (which should be unreachable via the push-decision-gate
 * disabling), the function refuses to issue the API call. Pins the helper
 * contract.
 */

describe('shouldRefusePush', () => {
  it('returns true when credentialsSkipped is true', () => {
    expect(shouldRefusePush({ credentialsSkipped: true })).toBe(true);
  });

  it('returns false when credentialsSkipped is false', () => {
    expect(shouldRefusePush({ credentialsSkipped: false })).toBe(false);
  });
});

describe('buildSkippedPushTransition', () => {
  it('routes to print-gate (the print-files local-save path)', () => {
    expect(buildSkippedPushTransition()).toEqual({ step: 'print-gate' });
  });
});
