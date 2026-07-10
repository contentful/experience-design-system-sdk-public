import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import {
  useLineage,
  type UseLineageResult,
} from '../../../../src/import/tui/hooks/useLineage.js';
import type { ComponentGraphNode } from '../../../../src/analyze/composite-closure.js';

// Ink-based renderHook shim: mount a probe component that surfaces the hook
// result via a ref, then read it after render.
function useHookProbe<T>(hook: () => T): T {
  const captured: { current: T | null } = { current: null };
  function Probe(): React.ReactElement | null {
    captured.current = hook();
    return React.createElement(Text, null, '');
  }
  render(React.createElement(Probe));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return captured.current!;
}

describe('useLineage', () => {
  it('for a middle node C in P→C→X: ancestors include P, descendants include X, jumpables exclude sections', () => {
    // Graph: P → C → X (P slots C; C slots X)
    const graph: ComponentGraphNode[] = [
      { name: 'P', slots: [{ name: 'body', allowedComponents: ['C'] }] },
      { name: 'C', slots: [{ name: 'body', allowedComponents: ['X'] }] },
      { name: 'X', slots: [] },
    ];

    // Focus P (root) — reveals descendants.
    const forP: UseLineageResult = useHookProbe(() => useLineage('P', graph));
    const pDescendants = forP.entries
      .filter((e) => e.kind === 'descendant')
      .map((e) => e.label)
      .join(' ');
    expect(pDescendants).toContain('C');
    expect(pDescendants).toContain('X');

    // Focus C — reveals P as ancestor.
    const forC: UseLineageResult = useHookProbe(() => useLineage('C', graph));
    const cAncestors = forC.entries
      .filter((e) => e.kind === 'ancestor')
      .map((e) => e.label)
      .join(' ');
    expect(cAncestors).toContain('P');
    // Sections always present.
    expect(forC.entries.map((e) => e.kind)).toContain('section');
    // Jumpables never include sections or empties.
    for (const j of forC.jumpables) {
      expect(['ancestor', 'descendant']).toContain(j.entry.kind);
    }
    // Descendant rows never include self (C).
    const cDescendantTargets = forC.jumpables
      .filter((j) => j.entry.kind === 'descendant')
      .map((j) => (j.entry.kind === 'descendant' ? j.entry.jumpTarget : ''));
    expect(cDescendantTargets).not.toContain('C');

    // Focused key `null` yields empty arrays.
    const empty = useHookProbe(() => useLineage(null, graph));
    expect(empty.entries).toEqual([]);
    expect(empty.jumpables).toEqual([]);
  });
});
