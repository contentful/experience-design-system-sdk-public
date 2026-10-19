import { AGENT_NAMES, type AgentName } from '@contentful/experience-design-system-backend-pipeline';
import type { Snapshot } from '../../shared/debug-trail.js';
import { inspectAgent, type AgentCheck } from './agent-status.js';
import type { AgentConfig } from './agent-store.js';

// What the Agents log records, split out of the screen so the screen only calls it.

/**
 * The agent settings as flat text, for `diffSnapshots`: `default_agent`, then `<agent>.model` and `<agent>.binary` for
 * every agent. Taken on entry and on exit, so the log shows what a visit changed.
 */
export function agentSnapshot(config: AgentConfig): Snapshot {
  const snapshot: Snapshot = { default_agent: config.defaultAgent };
  for (const name of AGENT_NAMES) {
    snapshot[`${name}.model`] = config.agents[name].model;
    snapshot[`${name}.binary`] = config.agents[name].binary;
  }
  return snapshot;
}

export type AgentEnvironment = {
  /** Whether the command was found, and the path it resolved to. */
  found: boolean;
  resolved_path: string;
  version: string;
  /**
   * The `EDS_AGENT_BINARY_<AGENT>` variable when it points somewhere other than the saved path. Settings copies a saved
   * path into that variable at startup, so a value equal to the saved path is not an override and is left out.
   */
  env_override: string;
};

/** What the quick checks found for one agent, as plain facts for the log. */
function environmentFrom(
  checks: readonly AgentCheck[],
  savedBinary: string,
  envValue: string | undefined,
): AgentEnvironment {
  const path = checks.find((check) => check.step === 'path');
  const version = checks.find((check) => check.step === 'version');
  const overridden = envValue !== undefined && envValue !== '' && envValue !== savedBinary.trim();
  return {
    found: path?.ok === true,
    resolved_path: path?.ok ? path.detail : '',
    version: version?.ok ? version.detail : '',
    env_override: overridden ? envValue : '',
  };
}

/**
 * What is true about each agent on this machine, so "my agent does not work" can be read from the log: found or not,
 * where, its version, and whether a shell variable is overriding the saved path. Uses the quick checks only, so it never
 * spends a prompt.
 */
export async function describeAgents(config: AgentConfig): Promise<Record<AgentName, AgentEnvironment>> {
  const entries = await Promise.all(
    AGENT_NAMES.map(async (name) => {
      const saved = config.agents[name].binary;
      const checks = await inspectAgent(name, saved);
      return [name, environmentFrom(checks, saved, process.env[`EDS_AGENT_BINARY_${name.toUpperCase()}`])] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<AgentName, AgentEnvironment>;
}
