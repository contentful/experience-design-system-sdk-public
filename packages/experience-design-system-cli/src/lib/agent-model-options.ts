import type { Command } from 'commander';

export const AGENT_DESCRIPTION =
  'Agent to use: claude, codex, opencode, cursor (defaults to value saved by experiences setup)';

export const MODEL_DESCRIPTION =
  'Model to use (defaults to a lightweight per-agent model; override with EDS_AGENT_MODEL_<AGENT>)';

export interface AgentModelOptionsConfig {
  agentDescription?: string;
  includeModel?: boolean;
  modelDescription?: string;
}

export function addAgentModelOptions(cmd: Command, config: AgentModelOptionsConfig = {}): Command {
  const { agentDescription = AGENT_DESCRIPTION, includeModel = true, modelDescription = MODEL_DESCRIPTION } = config;

  cmd.option('--agent <name>', agentDescription);
  if (includeModel) {
    cmd.option('--model <name>', modelDescription);
  }
  return cmd;
}
