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
  const defaultValue = current ?? false;
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`  Disable anonymous usage analytics? ${hint} `)).trim().toLowerCase();
  if (answer === '') return defaultValue;
  if (answer.startsWith('y')) return true;
  if (answer.startsWith('n')) return false;
  return defaultValue;
}
