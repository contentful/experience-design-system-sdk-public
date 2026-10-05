import type { Command } from 'commander';
import { AGENT_NAMES, agentSupportsBedrock } from '@contentful/experience-design-system-generation';

export const AGENT_DESCRIPTION = `Agent to use: ${AGENT_NAMES.join(', ')} (defaults to value saved by experiences setup)`;

export const MODEL_DESCRIPTION =
  'Model to use (defaults to a lightweight per-agent model; override with EDS_AGENT_MODEL_<AGENT>)';

const BEDROCK_AGENTS = AGENT_NAMES.filter((agent) => agentSupportsBedrock(agent)).join(', ');

const BEDROCK_DESCRIPTION = `Route the selected agent through AWS Bedrock instead of its default model provider (requires AWS credentials in the environment: AWS_PROFILE, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN, plus AWS_REGION). Only supported by agents with a Bedrock routing mechanism (currently: ${BEDROCK_AGENTS}).`;

export interface AgentModelOptionsConfig {
  agentDescription?: string;
  includeModel?: boolean;
  includeBedrock?: boolean;
  modelDescription?: string;
}

/**
 * Register --agent plus optional --model and --bedrock flags with a Commander
 * command. The optional flags can be omitted for commands with a narrower
 * public surface.
 */
export function addAgentModelOptions(cmd: Command, config: AgentModelOptionsConfig = {}): Command {
  const {
    agentDescription = AGENT_DESCRIPTION,
    includeModel = true,
    includeBedrock = true,
    modelDescription = MODEL_DESCRIPTION,
  } = config;

  cmd.option('--agent <name>', agentDescription);
  if (includeModel) {
    cmd.option('--model <name>', modelDescription);
  }
  if (includeBedrock) cmd.option('--bedrock', BEDROCK_DESCRIPTION);
  return cmd;
}
