const SELECTION_PHASES = ['broadcast', 'diff', 'tier', 'escalate', 'determine', 'assemble'] as const;
export type SelectionPhase = (typeof SELECTION_PHASES)[number];

type PhaseGateStatus = 'awaiting-approval' | 'paused' | 'complete';

export interface SelectionPhaseGate<TOutput> {
  phase: SelectionPhase;
  output: TOutput;
  nextPhase?: SelectionPhase;
  status: PhaseGateStatus;
}

export interface PhaseApproval {
  continue: boolean;
}

function nextPhase(phase: SelectionPhase): SelectionPhase | undefined {
  const index = SELECTION_PHASES.indexOf(phase);
  return SELECTION_PHASES[index + 1];
}

export function createSelectionPhaseGate<TOutput>(phase: SelectionPhase, output: TOutput): SelectionPhaseGate<TOutput> {
  return {
    phase,
    output,
    nextPhase: nextPhase(phase),
    status: 'awaiting-approval',
  };
}

export function advanceSelectionPhase<TOutput>(
  gate: SelectionPhaseGate<TOutput>,
  approval: PhaseApproval,
): SelectionPhaseGate<TOutput> {
  if (!approval.continue) return { ...gate, status: 'paused' };
  return { ...gate, status: gate.nextPhase ? 'awaiting-approval' : 'complete' };
}
