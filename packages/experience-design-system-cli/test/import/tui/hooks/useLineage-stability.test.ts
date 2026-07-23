import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { Text } from 'ink';
import {
  useLineage,
  type UseLineageResult,
} from '../../../../src/import/tui/hooks/useLineage.js';
import type { ComponentGraphNode } from '../../../../src/analyze/composite-closure.js';

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

    const { rerender } = render(React.createElement(Probe, { graph: makeGraph() }));
    rerender(React.createElement(Probe, { graph: makeGraph() }));

    expect(captured.length).toBeGreaterThanOrEqual(2);
    const first = captured[0];
    const last = captured[captured.length - 1];

    expect(first.entries.some((e) => e.kind === 'ancestor')).toBe(true);

    expect(last.entries).toBe(first.entries);
    expect(last.jumpables).toBe(first.jumpables);
  });
});
