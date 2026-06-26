import { appendRun, type RunRecord } from '../../runs/store.js';
import { resolveSavePath, type OnConflictMode } from '../../runs/save-path-resolver.js';

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
  /**
   * Headless conflict-resolution mode (`--on-conflict`). Only meaningful when
   * `outDirOverride` is also set — otherwise we still need to prompt for the
   * path interactively. When provided alongside an override, the conflict
   * gate is bypassed and the mode is applied via `resolveSavePath`.
   */
  onConflict?: OnConflictMode | undefined;
};

export type PlanSaveFlowOutput =
  | { kind: 'write'; path: string }
  | { kind: 'prompt'; defaultPath: string }
  | { kind: 'fail'; conflict: { path: string; files: string[] } };

export async function planSaveFlow(input: PlanSaveFlowInput): Promise<PlanSaveFlowOutput> {
  if (input.outDirOverride) {
    if (input.onConflict) {
      const resolved = await resolveSavePath(input.outDirOverride, { onConflict: input.onConflict });
      if (resolved.kind === 'write') return { kind: 'write', path: resolved.path };
      if (resolved.kind === 'fail') return { kind: 'fail', conflict: resolved.conflict };
      // `no-conflict` / `conflict` never come back when onConflict is set.
      return { kind: 'write', path: input.outDirOverride };
    }
    return { kind: 'write', path: input.outDirOverride };
  }
  return { kind: 'prompt', defaultPath: input.defaultPath };
}

export type RecordRunAfterSaveInput = Omit<RunRecord, 'id' | 'createdAt'>;

export async function recordRunAfterSave(input: RecordRunAfterSaveInput): Promise<RunRecord> {
  return appendRun(input);
}
