import { describe, expect, it, vi } from 'vitest';
import {
  nextStepAfterScopeGate,
  nextStepAfterCredentialsValidated,
  shouldBypassPreview,
  buildSkippedPreviewTransition,
  shouldRefusePush,
  buildSkippedPushTransition,
} from '../../../src/import/tui/wizard-state-transitions.js';

/**
 * Skip-credentials spec — Task 5. End-to-end pin: a full state-machine walk
 * through the skipped-credentials flow, asserting that:
 *
 *   1. Each transition lands on the expected step.
 *   2. `previewImport` is never invoked at the preview stage.
 *   3. `runPush` (if somehow reached) refuses and routes to print-gate.
 *
 * The wizard's real WizardApp.tsx wires these helpers into the live state.
 * This file pins the transitions in isolation so any future refactor that
 * silently broke the skipped-credentials flow would fail loudly here.
 */

describe('wizard flow — credentials skipped end-to-end', () => {
  it('walks extract → scope-gate → credentials → skip → preview-bypass → push-decision-gate → save-only → done without calling previewImport', async () => {
    // Stub API client. Pin: previewImport must never fire.
    const previewImport = vi.fn();
    const applyImport = vi.fn();

    // ── Step: scope-gate confirmed with accepted > 0, push enabled.
    //   noPush flag is the pre-launch path; this spec is the in-screen
    //   skip path, so noPush stays false (push is enabled at flag level).
    const afterScope = nextStepAfterScopeGate({ acceptedCount: 5, noPush: false });
    expect(afterScope).toBe('credentials');

    // ── Step: operator presses `s` on the credentials screen. Wizard sets
    //   `credentialsSkipped: true` and runs the same post-credentials
    //   advance helper as the validated path.
    const state = { credentialsSkipped: true, acceptedCount: 5 };
    const afterCreds = nextStepAfterCredentialsValidated({ acceptedCount: state.acceptedCount });
    expect(afterCreds).toBe('generating');

    // ── Step: generation completes (out of scope for this pin — we just
    //   need to land at preview/push-decision-gate).

    // ── Step: runPreview is called. The guard short-circuits.
    if (shouldBypassPreview(state)) {
      const patch = buildSkippedPreviewTransition();
      expect(patch.step).toBe('push-decision-gate');
      expect(patch.serverPreview).toBeNull();
    } else {
      await previewImport();
    }
    expect(previewImport).not.toHaveBeenCalled();

    // ── Step: push-decision-gate renders with pushDisabled = true and
    //   only "Save only" is selectable. The operator picks save-only;
    //   that fires the print-files local-save path (no runPush call).

    // ── Defensive: if a future regression routed an operator into
    //   runPush anyway, the guard refuses and re-routes to print-gate.
    if (shouldRefusePush(state)) {
      const patch = buildSkippedPushTransition();
      expect(patch.step).toBe('print-gate');
    } else {
      await applyImport();
    }
    expect(applyImport).not.toHaveBeenCalled();
  });

  it('non-skipped flow is unchanged: preview is called, push refusal does not fire', async () => {
    const previewImport = vi.fn();
    const applyImport = vi.fn();

    const state = { credentialsSkipped: false };

    if (shouldBypassPreview(state)) {
      // skip
    } else {
      await previewImport();
    }
    expect(previewImport).toHaveBeenCalledTimes(1);

    if (shouldRefusePush(state)) {
      // refuse
    } else {
      await applyImport();
    }
    expect(applyImport).toHaveBeenCalledTimes(1);
  });
});
