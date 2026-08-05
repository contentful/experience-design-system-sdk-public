import type { Command } from 'commander';
import { AGENT_NAMES } from '../generate/agent-runner.js';

export const AGENT_DESCRIPTION = `Agent to use: ${AGENT_NAMES.join(', ')} (defaults to value saved by experiences setup)`;

export const MODEL_DESCRIPTION =
  'Model to use (defaults to a lightweight per-agent model; override with EDS_AGENT_MODEL_<AGENT>)';

export interface AgentModelOptionsConfig {
  agentDescription?: string;
  includeModel?: boolean;
  modelDescription?: string;
}

/**
 * Register --agent and optionally --model flags to a Commander command, with customizable descriptions.
 * Pass `includeModel: false` for commands where the model dimension is not applicable (e.g., mapping-resolution agents that select an agent for logic, not model choice).
 */
export function addAgentModelOptions(cmd: Command, config: AgentModelOptionsConfig = {}): Command {
  const { agentDescription = AGENT_DESCRIPTION, includeModel = true, modelDescription = MODEL_DESCRIPTION } = config;

  cmd.option('--agent <name>', agentDescription);
  if (includeModel) {
    cmd.option('--model <name>', modelDescription);
  }
  return cmd;
}
