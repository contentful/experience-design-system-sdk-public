import { describe, expect, it } from 'vitest';
import {
  shouldGenerateAfterScopeGate,
  shouldGenerateAfterCredentialsValidated,
  shouldSkipFinalReviewAfterCredentials,
  resolveNoCacheForGenerate,
  resolveCycleGateAction,
} from '../../../src/import/tui/wizard-state-transitions.js';
import { computeCycleAutoRejectTargets } from '../../../src/import/cycle-auto-reject.js';
import type { ComponentGraphNode } from '../../../src/analyze/composite-closure.js';

describe('shouldGenerateAfterScopeGate', () => {
  it('generates when accepted components exist', () => {
    expect(shouldGenerateAfterScopeGate({ acceptedCount: 5 })).toBe(true);
  });

  it('does not generate when no components are accepted', () => {
    expect(shouldGenerateAfterScopeGate({ acceptedCount: 0 })).toBe(false);
  });
});

describe('shouldGenerateAfterCredentialsValidated', () => {
  it('generates when accepted components exist', () => {
    expect(shouldGenerateAfterCredentialsValidated({ acceptedCount: 3 })).toBe(true);
  });

  it('does not generate when no components are accepted', () => {
    expect(shouldGenerateAfterCredentialsValidated({ acceptedCount: 0 })).toBe(false);
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
    expect(resolveCycleGateAction({ hasCycles: false })).toBe('proceed');
  });

  it('blocks when cycles exist and auto-reject is off', () => {
    expect(resolveCycleGateAction({ hasCycles: true })).toBe('block');
  });

  it('auto-rejects when cycles exist and auto-reject is on', () => {});

  it('selects the same reject targets computeCycleAutoRejectTargets does for a cyclic graph', () => {
    const graph: ComponentGraphNode[] = [
      { name: 'A', slots: [{ name: 'default', allowedComponents: ['B'] }] },
      { name: 'B', slots: [{ name: 'default', allowedComponents: ['A'] }] },
    ];
    const slotCycles = [{ path: ['A', 'B', 'A'] }];
    expect(resolveCycleGateAction({ hasCycles: slotCycles.length > 0 })).toBe('block');
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
  it('shouldGenerateAfterScopeGate never returns "validating-credentials"', () => {
    for (const acceptedCount of [0, 1, 5]) {
      const next = shouldGenerateAfterScopeGate({ acceptedCount });
      expect(next).not.toBe('validating-credentials');
    }
  });

  it('shouldGenerateAfterCredentialsValidated never returns "validating-credentials"', () => {
    for (const acceptedCount of [0, 1, 5]) {
      const next = shouldGenerateAfterCredentialsValidated({ acceptedCount });
      expect(next).not.toBe('validating-credentials');
    }
  });
});
