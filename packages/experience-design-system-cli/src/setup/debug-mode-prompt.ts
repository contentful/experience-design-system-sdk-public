import { promptBooleanPreference } from './prompt-helpers.js';

/**
 * Ask the operator whether to enable debug logging by default.
 *
 * When ON, every command writes a JSONL trace of its decisions to
 * ~/.contentful/experience-design-system-cli/debug/. Off by default because
 * the trace file grows quickly and contains verbose per-tool-call detail
 * intended for developers debugging the CLI.
 *
 * Injectable `ask` so tests can drive without a TTY.
 */
export async function promptDebugModePreference(
  ask: (q: string) => Promise<string>,
  current?: boolean,
): Promise<boolean> {
  return promptBooleanPreference(ask, current, false, 'Enable debug logging by default?');
}
