import { promptBooleanPreference } from './prompt-helpers.js';

/**
 * Ask the operator whether to persist an opt-out of anonymous usage analytics.
 *
 * The helper is injectable so it can be unit-tested without a TTY. The caller
 * provides an `ask` function that yields one line of input per call.
 *
 * Behavior:
 *   - Empty input returns `current` if defined, else `false` (default: enabled).
 *   - Input starting with 'y' or 'Y' returns `true` (disabled).
 *   - Input starting with 'n' or 'N' returns `false` (enabled).
 *   - Any other input falls back to the same rule as empty input.
 */
export async function promptAnalyticsPreference(
  ask: (q: string) => Promise<string>,
  current?: boolean,
): Promise<boolean> {
  return promptBooleanPreference(ask, current, false, 'Disable anonymous usage analytics?');
}
