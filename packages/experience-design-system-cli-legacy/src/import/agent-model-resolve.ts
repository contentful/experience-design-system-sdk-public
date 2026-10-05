/**
 * Resolution chain for the combined `--agent` override on `experiences import`.
 *
 * The wizard path previously hard-defaulted `--agent` to `'claude'` at the
 * commander layer, which (a) shadowed the stored `credentials.json` value when
 * the user passed no flag, and (b) made it impossible to distinguish "user
 * explicitly passed --agent claude" from "user passed nothing". The combined
 * flag accepts either `agent:model` or `agent model`.
 *
 * These helpers produce the resolved values to feed into `WizardApp` /
 * the import wizard:
 *
 *   1. CLI flag wins when provided.
 *   2. Otherwise, the value persisted in `credentials.json` (written by
 *      `experiences setup`) is used.
 *   3. Otherwise, the built-in default (currently `'claude'`) is used for
 *      the agent. Model has no default — agents pick a small/fast model
 *      themselves when no model is included in `--agent`.
 */

/** Built-in fallback agent when neither a flag nor a stored preference is set. */
export const DEFAULT_AGENT = 'claude';

export function parseAgentModel(value: string | undefined): { agent?: string; model?: string } {
  if (!value?.trim()) return {};
  const trimmed = value.trim();
  const separator = trimmed.indexOf(':');
  if (separator >= 0) {
    return {
      agent: trimmed.slice(0, separator).trim() || undefined,
      model: trimmed.slice(separator + 1).trim() || undefined,
    };
  }
  const [agent, ...modelParts] = trimmed.split(/\s+/);
  return { agent, ...(modelParts.length > 0 ? { model: modelParts.join(' ') } : {}) };
}

export function resolveAgent(flagValue: string | undefined, storedValue: string | undefined): string {
  if (flagValue && flagValue.length > 0) return flagValue;
  if (storedValue && storedValue.length > 0) return storedValue;
  return DEFAULT_AGENT;
}

export function resolveModel(flagValue: string | undefined, storedValue: string | undefined): string | undefined {
  if (flagValue && flagValue.length > 0) return flagValue;
  if (storedValue && storedValue.length > 0) return storedValue;
  return undefined;
}
