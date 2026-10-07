import { AGENT_BINARIES } from '../constants/binaries.js';
import type { AgentName } from '../types/agent-name.js';

export function resolveBinary(agent: AgentName): string {
  const override = process.env[`EDS_AGENT_BINARY_${agent.toUpperCase()}`];
  if (override && override.trim()) return override.trim();
  return AGENT_BINARIES[agent];
}
