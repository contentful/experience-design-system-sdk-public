import type { RunPickerSelection } from '../runs/run-picker.js';
import type { replayRun as replayRunFn, modifyRun as modifyRunFn } from '../runs/replay-helpers.js';
import type { pickerPushRun as pickerPushRunFn } from '../runs/push-launcher.js';

export type PickerDispatchOptions = {
  // replay (push) options
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  interactive?: boolean;
  // modify options
  outDir?: string;
  overwrite?: boolean;
  saveAsNew?: boolean;
  // shared
  force?: boolean;
};

export type PickerDispatchDeps = {
  replayRun: typeof replayRunFn;
  modifyRun: typeof modifyRunFn;
  /**
   * Interactive picker-Push launcher — mounts the wizard so the operator sees
   * preview + push progress + view URL rather than a single-line summary.
   * Optional so existing test fixtures that only stub {replayRun, modifyRun}
   * still type-check; when omitted, picker-Push falls back to replayRun.
   */
  pickerPushRun?: typeof pickerPushRunFn;
};

// Route a resolved RunPickerSelection into replayRun / modifyRun / picker-push.
// Extracted from command.ts so the dispatch decision is testable without an
// Ink runtime and so the picker callback in command.ts is a simple
// state-capture (no process.exit shenanigans that would kill the process
// before dispatch runs).
export async function dispatchPickerSelection(
  selection: RunPickerSelection,
  opts: PickerDispatchOptions,
  deps: PickerDispatchDeps,
): Promise<void> {
  if (selection.action === 'push' && selection.runId) {
    // Interactive TTY → mount the wizard's preview + push UX. Non-interactive
    // (CI / scripted / non-TTY) → keep the headless shell-out via replayRun
    // that `experiences import --push-from-run <id>` relies on.
    if (opts.interactive !== false && deps.pickerPushRun) {
      await deps.pickerPushRun({
        runIdOrPath: selection.runId,
        ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
        ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
        ...(opts.cmaToken ? { cmaToken: opts.cmaToken } : {}),
        ...(opts.host ? { host: opts.host } : {}),
        ...(opts.force ? { force: true } : {}),
      });
      return;
    }
    await deps.replayRun({
      runIdOrPath: selection.runId,
      ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
      ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
      ...(opts.cmaToken ? { cmaToken: opts.cmaToken } : {}),
      ...(opts.host ? { host: opts.host } : {}),
      ...(opts.interactive !== undefined ? { interactive: opts.interactive } : {}),
      ...(opts.force ? { force: true } : {}),
    });
    return;
  }
  if (selection.action === 'modify' && selection.runId) {
    await deps.modifyRun({
      runIdOrPath: selection.runId,
      ...(opts.outDir ? { outDir: opts.outDir } : {}),
      ...(opts.overwrite ? { overwrite: true } : {}),
      ...(opts.saveAsNew ? { saveAsNew: true } : {}),
      ...(opts.force ? { force: true } : {}),
    });
    return;
  }
  // action === 'new' → no-op; the wizard already advanced past the picker.
}
