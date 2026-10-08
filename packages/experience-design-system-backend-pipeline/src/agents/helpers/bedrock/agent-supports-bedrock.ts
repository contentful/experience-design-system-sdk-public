import { BEDROCK_CAPABLE_AGENTS } from '../../constants/bedrock.js';
import type { AgentName } from '../../types/agent-name.js';

export function agentSupportsBedrock(agent: AgentName): boolean {
  return BEDROCK_CAPABLE_AGENTS.has(agent);
}
