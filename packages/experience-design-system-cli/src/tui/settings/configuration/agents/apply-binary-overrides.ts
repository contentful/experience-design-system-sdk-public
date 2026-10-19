import { AGENT_NAMES } from '@contentful/experience-design-system-backend-pipeline';
import type { AgentConfig } from './agent-store.js';

// What the shell had in each variable before a saved path replaced it, so clearing the path puts it back.
const shellValues = new Map<string, string | undefined>();

/**
 * The pipeline picks an agent's binary from `EDS_AGENT_BINARY_<AGENT>` and nowhere else. This copies each saved
 * `agents.<name>.binary` into that variable, so the saved path reaches every place that spawns an agent (the import,
 * the generation package and the legacy commands) without touching their call sites.
 *
 * Called once at startup, and again after Settings saves a binary so a change applies without a restart.
 *
 * Settings wins over a variable already in the shell, so a forgotten `EDS_AGENT_BINARY_CLAUDE` cannot silently override
 * what the user sees on screen. An agent with no saved path leaves the shell's variable alone, and clearing a path
 * puts the shell's value back.
 */
export function applyBinaryOverrides(config: AgentConfig): void {
  for (const name of AGENT_NAMES) {
    const key = `EDS_AGENT_BINARY_${name.toUpperCase()}`;
    const binary = config.agents[name].binary.trim();

    if (binary) {
      if (!shellValues.has(key)) shellValues.set(key, process.env[key]);
      process.env[key] = binary;
    } else if (shellValues.has(key)) {
      const shellValue = shellValues.get(key);
      if (shellValue === undefined) delete process.env[key];
      else process.env[key] = shellValue;
      shellValues.delete(key);
    }
  }
}
