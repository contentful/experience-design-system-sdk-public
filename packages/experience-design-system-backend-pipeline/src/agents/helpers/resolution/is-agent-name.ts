import { AGENT_NAMES, type AgentName } from '../../types/agent-name.js';

export function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value);
}
