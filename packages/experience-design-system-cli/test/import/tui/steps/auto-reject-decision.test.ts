import { describe, it, expect } from 'vitest';
import { computeAutoRejectDecision } from '../../../../src/import/tui/steps/auto-reject-decision.js';

describe('computeAutoRejectDecision — strict one-shot (T2)', () => {
  it('loading → skip regardless of cycles', () => {
    expect(
      computeAutoRejectDecision({ loading: true, autoRejectFired: false, hasCycle: true }),
    ).toBe('skip');
  });

  it('post-load, no cycle → skip (never fires this session)', () => {
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: false, hasCycle: false }),
    ).toBe('skip');
  });

  it('post-load, cycle, not yet fired → fire', () => {
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: false, hasCycle: true }),
    ).toBe('fire');
  });

  it('already fired + a NEW cycle appears (edit-induced) → skip (strict one-shot)', () => {
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: true, hasCycle: true }),
    ).toBe('skip');
  });

  it('already fired + cycle set went to zero → skip (no clear, no re-arm)', () => {
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: true, hasCycle: false }),
    ).toBe('skip');
  });

  it('never fires when the initial cycle set is empty even if a cycle later emerges', () => {
    let fired = false;
    const first = computeAutoRejectDecision({ loading: false, autoRejectFired: fired, hasCycle: false });
    expect(first).toBe('skip');
    const second = computeAutoRejectDecision({ loading: false, autoRejectFired: fired, hasCycle: true });
    expect(second).toBe('fire');
    fired = true;
    expect(
      computeAutoRejectDecision({ loading: false, autoRejectFired: fired, hasCycle: true }),
    ).toBe('skip');
  });
});
