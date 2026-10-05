import { describe, expect, it } from 'vitest';
import { advanceSelectionPhase, createSelectionPhaseGate } from '../src/selection-phase-gates.js';

describe('selection phase gates', () => {
  it('pauses when the caller does not approve continuation', () => {
    const gate = createSelectionPhaseGate('diff', { disagreements: [] });

    expect(advanceSelectionPhase(gate, { continue: false })).toEqual({
      phase: 'diff',
      output: { disagreements: [] },
      nextPhase: 'tier',
      status: 'paused',
    });
  });

  it('requires explicit approval at every phase and completes after assembly', () => {
    const gate = createSelectionPhaseGate('assemble', { selections: [] });

    expect(gate.status).toBe('awaiting-approval');
    expect(advanceSelectionPhase(gate, { continue: true })).toEqual({
      phase: 'assemble',
      output: { selections: [] },
      nextPhase: undefined,
      status: 'complete',
    });
  });
});
