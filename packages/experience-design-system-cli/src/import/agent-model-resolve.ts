/**
 * Resolution chain for `--agent` and `--model` overrides on `experiences import`.
 *
 * The wizard path previously hard-defaulted `--agent` to `'claude'` at the
 * commander layer, which (a) shadowed the stored `credentials.json` value when
 * the user passed no flag, and (b) made it impossible to distinguish "user
 * explicitly passed --agent claude" from "user passed nothing". `--model` was
 * registered but never threaded into the wizard subprocesses at all.
 *
 * These helpers produce the resolved values to feed into `WizardApp` /
 * `runPipeline`:
 *
 *   1. CLI flag wins when provided.
 *   2. Otherwise, the value persisted in `credentials.json` (written by
 *      `experiences setup`) is used.
 *   3. Otherwise, the built-in default (currently `'claude'`) is used for
 *      the agent. Model has no default — agents pick a small/fast model
 *      themselves when `--model` is omitted.
 */

/** Built-in fallback agent when neither a flag nor a stored preference is set. */
export const DEFAULT_AGENT = 'claude';

export function resolveAgent(
  flagValue: string | undefined,
  storedValue: string | undefined,
): string {
  if (flagValue && flagValue.length > 0) return flagValue;
  if (storedValue && storedValue.length > 0) return storedValue;
  return DEFAULT_AGENT;
}

export function resolveModel(
  flagValue: string | undefined,
  storedValue: string | undefined,
): string | undefined {
  if (flagValue && flagValue.length > 0) return flagValue;
  if (storedValue && storedValue.length > 0) return storedValue;
  return undefined;
}
