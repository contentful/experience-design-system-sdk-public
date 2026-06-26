/**
 * Ask the operator whether to enable the AI auto-filter by default.
 *
 * The helper is injectable so it can be unit-tested without a TTY. The caller
 * provides an `ask` function that yields one line of input per call.
 *
 * Behavior:
 *   - Empty input returns `current` if defined, else `true` (default ON).
 *   - Input starting with 'y' or 'Y' returns `true`.
 *   - Input starting with 'n' or 'N' returns `false`.
 *   - Any other input falls back to the same rule as empty input.
 */
export async function promptAutoFilterPreference(
  ask: (q: string) => Promise<string>,
  current?: boolean,
): Promise<boolean> {
  const defaultValue = current ?? true;
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`  Enable AI auto-filter by default? ${hint} `)).trim().toLowerCase();
  if (answer === '') return defaultValue;
  if (answer.startsWith('y')) return true;
  if (answer.startsWith('n')) return false;
  return defaultValue;
}
