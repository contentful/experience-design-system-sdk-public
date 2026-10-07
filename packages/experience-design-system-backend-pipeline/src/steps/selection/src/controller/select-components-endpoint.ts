import { isAgentName } from '../../../shared/agent/index.js';
import { DEFAULT_AGENT } from '../../../shared/constants/index.js';
import { runSelectionService } from '../services/run-selection-service.js';
import type { SelectComponentsEndpointRequest, SelectComponentsEndpointResponse } from '../types/contract.js';

export type { SelectComponentsEndpointRequest, SelectComponentsEndpointResponse };

export async function selectComponents(
  request: SelectComponentsEndpointRequest,
): Promise<SelectComponentsEndpointResponse> {
  const { agent: agentInput, ...rest } = request;

  if (agentInput !== undefined && !isAgentName(agentInput)) {
    throw new Error(`Unknown agent: "${agentInput}"`);
  }

  return runSelectionService({
    ...rest,
    agent: agentInput ?? DEFAULT_AGENT,
  });
}
