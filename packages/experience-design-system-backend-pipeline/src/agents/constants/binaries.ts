import type { AgentName } from '../types/agent-name.js';

export const AGENT_BINARIES: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  copilot: 'copilot',
};
