import type { PushDecisionChoice } from './steps/PushDecisionGateStep.js';

export type GateAction = 'save-and-push' | 'push-only' | 'save-only';

/**
 * Maps a `PushDecisionGateStep` choice to the wizard action it triggers.
 * Centralizing this keeps the gate component free of wizard-side semantics
 * and gives us a unit-testable seam between UI choice and side-effect.
 */
export function chooseGateAction(choice: PushDecisionChoice): GateAction {
  return choice === 'both' ? 'save-and-push' : choice;
}
