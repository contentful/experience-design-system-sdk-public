export interface ParsedAgentModel {
  agent?: string;
  model?: string;
}

/**
 * Parse an `agent:model` or `agent model` string into its two parts. Empty
 * input returns `{}`; empty slots return `undefined` for that slot.
 */
export function parseAgentModel(value: string | undefined): ParsedAgentModel {
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
