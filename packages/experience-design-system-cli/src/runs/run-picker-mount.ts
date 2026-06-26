import { readFile } from 'node:fs/promises';
import { READABLE_VERSIONS, runsFilePath, type RunRecord, type RunsFile } from './store.js';

type MaybeV1Record = Omit<RunRecord, 'tokensPath' | 'tokenSessionId'> &
  Partial<Pick<RunRecord, 'tokensPath' | 'tokenSessionId'>>;

function migrateRecord(rec: MaybeV1Record): RunRecord {
  return {
    ...rec,
    tokensPath: rec.tokensPath ?? null,
    tokenSessionId: rec.tokenSessionId ?? null,
  };
}

/**
 * Flags whose presence suppresses the run-picker. The picker is meant for the
 * fresh interactive `experiences import` entry point; any flag that already
 * routes the wizard down a non-default path means the operator has been
 * specific about intent, so we honor that and skip silently.
 *
 * Flag names match the camelCase option object commander hands to the action
 * handler (see `command.ts`).
 */
export type RunPickerFlags = {
  pushFromRun?: string;
  modify?: string;
  /** Set only when the operator explicitly passed `--project`. */
  project?: string;
  autoAcceptScope?: boolean;
  printPrompt?: boolean;
  dryRun?: boolean;
};

export type ShouldShowRunPickerInput = {
  flags: RunPickerFlags;
  isTTY: boolean;
  /** Absolute path to runs.json. Defaults to the platform-standard path. */
  runsJsonPath?: string;
};

export type ShouldShowRunPickerResult = {
  shouldShow: boolean;
  runs: RunRecord[];
};

function hasBlockingFlag(flags: RunPickerFlags): boolean {
  if (flags.pushFromRun !== undefined) return true;
  if (flags.modify !== undefined) return true;
  if (flags.project !== undefined) return true;
  if (flags.autoAcceptScope) return true;
  if (flags.printPrompt) return true;
  if (flags.dryRun) return true;
  return false;
}

/**
 * Pure decision helper for whether the wizard should open with the run picker.
 *
 * Picker shows iff ALL hold:
 *   1. `~/.config/experiences/runs.json` exists
 *   2. The file has >=1 run entry
 *   3. None of `--push-from-run`, `--modify`, `--project`,
 *      `--auto-accept-scope`, `--print-prompt`, or `--dry-run` were passed
 *   4. stdin is a TTY
 *
 * On any failure (including ENOENT or a parse error), the helper returns
 * `{ shouldShow: false, runs: [] }`. We deliberately swallow parse errors
 * here: the wizard's normal entry point is more important than surfacing a
 * malformed runs.json — the operator can still use `experiences runs ls` to
 * diagnose later.
 */
export async function shouldShowRunPicker(
  input: ShouldShowRunPickerInput,
): Promise<ShouldShowRunPickerResult> {
  if (!input.isTTY) return { shouldShow: false, runs: [] };
  if (hasBlockingFlag(input.flags)) return { shouldShow: false, runs: [] };

  const path = input.runsJsonPath ?? runsFilePath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { shouldShow: false, runs: [] };
  }
  let parsed: RunsFile & { runs: MaybeV1Record[] };
  try {
    parsed = JSON.parse(raw) as RunsFile & { runs: MaybeV1Record[] };
  } catch {
    return { shouldShow: false, runs: [] };
  }
  // Accept any version this CLI can read (see store.ts READABLE_VERSIONS).
  // Pre-PR-#78 v1 files are migrated to v2 in memory below; gating on strict
  // equality with RUNS_FILE_VERSION would silently hide every v1 run.
  if (!READABLE_VERSIONS.has(parsed.version)) {
    return { shouldShow: false, runs: [] };
  }
  const rawRuns = Array.isArray(parsed.runs) ? parsed.runs : [];
  if (rawRuns.length === 0) return { shouldShow: false, runs: [] };
  const runs = rawRuns.map(migrateRecord);
  return { shouldShow: true, runs };
}
