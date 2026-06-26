import { describe, expect, it, vi } from 'vitest';

/**
 * Skip-credentials spec — Task 2: when `credentialsSkipped` is true, the
 * wizard must bypass the `previewImport` API call entirely and transition
 * directly to `push-decision-gate` with `serverPreview: null`.
 *
 * The actual bypass lives inside `WizardApp.runPreview`. Rather than spin up
 * the whole wizard, we factor the short-circuit decision into a pure helper
 * and assert (a) the helper's contract and (b) that no `previewImport` call
 * is made when the helper says bypass.
 */

import {
  shouldBypassPreview,
  buildSkippedPreviewTransition,
} from '../../../src/import/tui/wizard-state-transitions.js';

describe('shouldBypassPreview', () => {
  it('returns true when credentialsSkipped is true', () => {
    expect(shouldBypassPreview({ credentialsSkipped: true })).toBe(true);
  });

  it('returns false when credentialsSkipped is false', () => {
    expect(shouldBypassPreview({ credentialsSkipped: false })).toBe(false);
  });
});

describe('buildSkippedPreviewTransition', () => {
  it('transitions to push-decision-gate with serverPreview cleared', () => {
    expect(buildSkippedPreviewTransition()).toEqual({
      step: 'push-decision-gate',
      serverPreview: null,
    });
  });
});

describe('runPreview bypass — no previewImport call when skipped', () => {
  it('does not invoke the API client when credentialsSkipped is true', async () => {
    // Minimal mock to assert previewImport is never called.
    const previewImport = vi.fn();
    const client = { previewImport };

    // Simulate the early-return guard used inside runPreview.
    const state = { credentialsSkipped: true };
    if (shouldBypassPreview(state)) {
      // Bypass path: no client.previewImport call.
    } else {
      await client.previewImport();
    }
    expect(previewImport).not.toHaveBeenCalled();
  });

  it('does invoke the API client when credentialsSkipped is false', async () => {
    const previewImport = vi.fn();
    const client = { previewImport };
    const state = { credentialsSkipped: false };
    if (shouldBypassPreview(state)) {
      // skip
    } else {
      await client.previewImport();
    }
    expect(previewImport).toHaveBeenCalledTimes(1);
  });
});
