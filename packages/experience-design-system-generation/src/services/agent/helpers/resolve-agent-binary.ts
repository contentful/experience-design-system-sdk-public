import type { AgentName } from '../../../agent-names.js';

const AGENT_BINARIES: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  copilot: 'copilot',
};

export function resolveAgentBinary(agent: AgentName): string {
  const envKey = `EDS_AGENT_BINARY_${agent.toUpperCase()}`;
  const override = process.env[envKey];
  if (override && override.trim()) return override.trim();
  return AGENT_BINARIES[agent];
}
