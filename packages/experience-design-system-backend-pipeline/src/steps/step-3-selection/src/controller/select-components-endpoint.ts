import { isAgentName } from '@contentful/experience-design-system-generation';
import { DEFAULT_AGENT } from '../../../shared/src/constants.js';
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
