import { AGENT_NAMES, agentSupportsBedrock, isAgentName } from '@contentful/experience-design-system-generation';
import type { AgentName } from '@contentful/experience-design-system-generation';
import { readExperiencesCredentials } from '../../credentials-store.js';
import { die } from '../../lib/cli-errors.js';
import type { GenerateSubcommandOptions } from '../command.js';

export interface ResolvedGenerateAgent {
  agent: AgentName;
  model: string | undefined;
  savedCreds: Awaited<ReturnType<typeof readExperiencesCredentials>>;
}

export async function resolveGenerateAgent(
  opts: Pick<GenerateSubcommandOptions, 'agent' | 'model' | 'bedrock'>,
): Promise<ResolvedGenerateAgent> {
  const savedCreds = await readExperiencesCredentials();
  const agentName = opts.agent ?? savedCreds.agent;
  const model = opts.model ?? savedCreds.agentModel;
  if (!agentName || !isAgentName(agentName)) {
    die(
      `Error: no agent configured. Pass --agent <name> or run experiences setup. Accepted values: ${AGENT_NAMES.join(', ')}`,
    );
  }
  const agent = agentName;
  if (opts.bedrock && !agentSupportsBedrock(agent)) {
    die(`Error: --bedrock is not supported for --agent ${agent}`);
  }
  return { agent, model, savedCreds };
}
