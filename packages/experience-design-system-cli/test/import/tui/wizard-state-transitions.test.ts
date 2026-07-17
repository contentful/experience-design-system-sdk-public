import { describe, expect, it } from 'vitest';
import {
  nextStepAfterScopeGate,
  nextStepAfterCredentialsValidated,
  shouldSkipFinalReviewAfterCredentials,
  resolveNoCacheForGenerate,
  resolveCycleGateAction,
} from '../../../src/import/tui/wizard-state-transitions.js';
import { computeCycleAutoRejectTargets } from '../../../src/import/cycle-auto-reject.js';
import type { ComponentGraphNode } from '../../../src/analyze/composite-closure.js';

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
  it('leaves the content-addressed cache enabled by default (no --no-cache)', () => {
    expect(resolveNoCacheForGenerate({ cliNoCache: false })).toBe(false);
  });

  it('honors --no-cache when explicitly opted in', () => {
    expect(resolveNoCacheForGenerate({ cliNoCache: true })).toBe(true);
  });
});

describe('resolveCycleGateAction', () => {
  it('proceeds when there are no cycles regardless of the flag', () => {
    expect(resolveCycleGateAction({ hasCycles: false, autoRejectCycles: false })).toBe('proceed');
    expect(resolveCycleGateAction({ hasCycles: false, autoRejectCycles: true })).toBe('proceed');
  });

  it('blocks when cycles exist and auto-reject is off', () => {
    expect(resolveCycleGateAction({ hasCycles: true, autoRejectCycles: false })).toBe('block');
  });

  it('auto-rejects when cycles exist and auto-reject is on', () => {
    expect(resolveCycleGateAction({ hasCycles: true, autoRejectCycles: true })).toBe('auto-reject');
  });

  it('selects the same reject targets computeCycleAutoRejectTargets does for a cyclic graph', () => {
    const graph: ComponentGraphNode[] = [
      { name: 'A', slots: [{ name: 'default', allowedComponents: ['B'] }] },
      { name: 'B', slots: [{ name: 'default', allowedComponents: ['A'] }] },
    ];
    const slotCycles = [{ path: ['A', 'B', 'A'] }];
    expect(resolveCycleGateAction({ hasCycles: slotCycles.length > 0, autoRejectCycles: true })).toBe('auto-reject');
    const targets = computeCycleAutoRejectTargets(slotCycles, graph);
    expect(targets.has('A')).toBe(true);
    expect(targets.has('B')).toBe(true);
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
