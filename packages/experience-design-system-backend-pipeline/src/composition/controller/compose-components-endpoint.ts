import { isAgentName } from '@contentful/experience-design-system-generation';
import type { AgentName } from '@contentful/experience-design-system-generation';
import { runCompositionService } from '../services/run-composition-service.js';
import type { ComposeComponentsRequest, ComposeComponentsResponse } from '../types/contract.js';

export type { ComposeComponentsRequest, ComposeComponentsResponse };

const DEFAULT_AGENT: AgentName = 'claude';

export async function composeComponents(request: ComposeComponentsRequest): Promise<ComposeComponentsResponse> {
  const { agent: agentInput, forceAgent, ...rest } = request;

  if (agentInput !== undefined && !isAgentName(agentInput)) {
    throw new Error(`Unknown agent: "${agentInput}"`);
  }

  return runCompositionService({
    ...rest,
    agent: agentInput ?? DEFAULT_AGENT,
    forceAgent: forceAgent ?? false,
  });
}
