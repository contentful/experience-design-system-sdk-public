import { describe, expect, it } from 'vitest';
import {
  buildSkippedPreviewTransition,
  buildSkippedPushTransition,
  resolveCycleGateAction,
  shouldBypassPreview,
  shouldRefusePush,
} from '../../../src/tui/import/steps/10-flow/support/wizard-state-transitions.js';

describe('resolveCycleGateAction', () => {
  it('proceeds when there are no cycles', () => {
    expect(resolveCycleGateAction({ hasCycles: false })).toBe('proceed');
  });

  it('blocks when cycles exist', () => {
    expect(resolveCycleGateAction({ hasCycles: true })).toBe('block');
  });
});

describe('shouldBypassPreview and shouldRefusePush', () => {
  it.each([
    [true, true],
    [false, false],
  ])('credentialsSkipped=%s means bypass=%s', (credentialsSkipped, expected) => {
    expect(shouldBypassPreview({ credentialsSkipped })).toBe(expected);
    expect(shouldRefusePush({ credentialsSkipped })).toBe(expected);
  });
});

describe('the transitions taken when credentials were skipped', () => {
  it('a skipped preview ends at done with no server preview', () => {
    expect(buildSkippedPreviewTransition()).toEqual({ step: 'done', serverPreview: null });
  });

  it('a refused push ends at the print gate, since the files are all there is to show', () => {
    expect(buildSkippedPushTransition()).toEqual({ step: 'print-gate' });
  });
});
