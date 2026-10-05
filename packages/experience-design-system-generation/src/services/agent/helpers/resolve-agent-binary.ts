import { AGENT_BINARIES, type AgentName } from '../../../agent-names.js';

export function resolveAgentBinary(agent: AgentName): string {
  const envKey = `EDS_AGENT_BINARY_${agent.toUpperCase()}`;
  const override = process.env[envKey];
  if (override && override.trim()) return override.trim();
  return AGENT_BINARIES[agent];
}
