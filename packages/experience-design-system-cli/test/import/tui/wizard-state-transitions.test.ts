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
