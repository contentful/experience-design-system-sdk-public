import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import {
  useLineage,
  type UseLineageResult,
} from '../../../../src/import/tui/hooks/useLineage.js';
import type { ComponentGraphNode } from '../../../../src/analyze/composite-closure.js';

// L2 (plan §4) — the lineage banner flashes in ScopeGate because the step
// feeds `useLineage` a freshly-built `graph` array on every render (the
// parent reloads scope components from the DB + spreads `[...components]`,
// so ScopeGate's `groupedItems`→`graph` memo chain rebuilds each render).
// `useLineage` gates its `closures`/`entries` memos on the `graph` reference,
// so an equivalent-but-new graph identity re-derives everything and the
// panel element churns. GenerateReview holds `components` in `useState`, so
// its graph identity is stable and it doesn't flash.
//
// This test pins the fix: across a no-op re-render that passes an
// equivalent-but-NEW graph array (same structure, new identity), the derived
// `entries` and `jumpables` must stay referentially STABLE.

function makeGraph(): ComponentGraphNode[] {
  return [
    { name: 'P', slots: [{ name: 'body', allowedComponents: ['C'] }] },
    { name: 'C', slots: [{ name: 'body', allowedComponents: ['X'] }] },
    { name: 'X', slots: [] },
  ];
}

describe('useLineage render stability (L2)', () => {
  it('returns referentially-stable entries/jumpables across a re-render with an equivalent-but-new graph', () => {
    const captured: UseLineageResult[] = [];

    function Probe({ graph }: { graph: ComponentGraphNode[] }): React.ReactElement | null {
      captured.push(useLineage('C', graph));
      return React.createElement(Text, null, '');
    }

    // First render with one graph identity.
    const { rerender } = render(React.createElement(Probe, { graph: makeGraph() }));
    // Re-render with a structurally-identical but brand-new graph array —
    // this mirrors ScopeGate handing `useLineage` a fresh `buildComponentGraph`
    // result on every parent render.
    rerender(React.createElement(Probe, { graph: makeGraph() }));

    expect(captured.length).toBeGreaterThanOrEqual(2);
    const first = captured[0];
    const last = captured[captured.length - 1];

    // Sanity: the derived data is meaningful (C has ancestor P).
    expect(first.entries.some((e) => e.kind === 'ancestor')).toBe(true);

    // The actual pin: identity must be preserved across the no-op re-render.
    expect(last.entries).toBe(first.entries);
    expect(last.jumpables).toBe(first.jumpables);
  });
});
