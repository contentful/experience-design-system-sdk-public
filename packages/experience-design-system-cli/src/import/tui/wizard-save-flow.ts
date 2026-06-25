import { appendRun, type RunRecord } from '../../runs/store.js';

/**
 * Wizard save-flow orchestration helpers (Task 4 / spec part 1+2).
 *
 * Kept as a separate module so the logic is testable without rendering the
 * full Ink WizardApp.
 */

export type PlanSaveFlowInput = {
  /** Resolved default save path (e.g. `${project}/.contentful`). */
  defaultPath: string;
  /** When set, bypass the inline prompt entirely (`--out-dir` flag). */
  outDirOverride?: string | undefined;
};

export type PlanSaveFlowOutput =
  | { kind: 'write'; path: string }
  | { kind: 'prompt'; defaultPath: string };

export function planSaveFlow(input: PlanSaveFlowInput): Promise<PlanSaveFlowOutput> {
  if (input.outDirOverride) {
    return Promise.resolve({ kind: 'write', path: input.outDirOverride });
  }
  return Promise.resolve({ kind: 'prompt', defaultPath: input.defaultPath });
}

export type RecordRunAfterSaveInput = Omit<RunRecord, 'id' | 'createdAt'>;

export async function recordRunAfterSave(input: RecordRunAfterSaveInput): Promise<RunRecord> {
  return appendRun(input);
}
