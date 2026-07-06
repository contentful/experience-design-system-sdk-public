import type { RunPickerSelection } from '../runs/run-picker.js';
import type { replayRun as replayRunFn, modifyRun as modifyRunFn } from '../runs/replay-helpers.js';

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
};

// Route a resolved RunPickerSelection into replayRun / modifyRun. Extracted
// from command.ts so the dispatch decision is testable without an Ink runtime
// and so the picker callback in command.ts is a simple state-capture (no
// process.exit shenanigans that would kill the process before dispatch runs).
export async function dispatchPickerSelection(
  selection: RunPickerSelection,
  opts: PickerDispatchOptions,
  deps: PickerDispatchDeps,
): Promise<void> {
  if (selection.action === 'push' && selection.runId) {
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
