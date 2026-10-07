import { isAgentName } from '../../../../agents/index.js';
import { DEFAULT_AGENT } from '../../../shared/constants/index.js';
import { runCompositionService } from '../services/run-composition-service.js';
import type { ComposeComponentsRequest, ComposeComponentsResponse } from '../types/contract.js';

export type { ComposeComponentsRequest, ComposeComponentsResponse };

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
