import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import {
  useReviewSurfaceState,
  type UseReviewSurfaceStateResult,
} from '../../../../src/import/tui/hooks/useReviewSurfaceState.js';
import { Text } from 'ink';

function mountProbe(initialFinalizeError?: string | null): { current: UseReviewSurfaceStateResult } {
  const ref: { current: UseReviewSurfaceStateResult | null } = { current: null };
  function Probe(): React.ReactElement {
    ref.current = useReviewSurfaceState(initialFinalizeError);
    return React.createElement(Text, null, '');
  }
  render(React.createElement(Probe));
  return ref as { current: UseReviewSurfaceStateResult };
}

describe('useReviewSurfaceState', () => {
  it('starts with the shared review-surface defaults', () => {
    const state = mountProbe();

    expect(state.current.sidebarFocused).toBe(true);
    expect(state.current.showFinalize).toBe(false);
    expect(state.current.showQuit).toBe(false);
    expect(state.current.finalizeError).toBeNull();
  });

  it('preserves the initial finalize error for a routed-back review', () => {
    const state = mountProbe('Nothing to push');

    expect(state.current.finalizeError).toBe('Nothing to push');
  });

  it('exposes setters for all shared surface state', () => {
    const state = mountProbe();

    state.current.setSidebarFocused(false);
    state.current.setShowFinalize(true);
    state.current.setShowQuit(true);
    state.current.setFinalizeError('Cannot finalize');

    expect(state.current.sidebarFocused).toBe(false);
    expect(state.current.showFinalize).toBe(true);
    expect(state.current.showQuit).toBe(true);
    expect(state.current.finalizeError).toBe('Cannot finalize');
  });
});
