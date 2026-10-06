import { isAgentName } from '@contentful/experience-design-system-generation';
import type { AgentName } from '@contentful/experience-design-system-generation';
import { runGenerationService } from '../services/run-generation-service.js';
import type { GenerateComponentsRequest, GenerateComponentsResponse } from '../types/contract.js';

export type { GenerateComponentsRequest, GenerateComponentsResponse };

const DEFAULT_AGENT: AgentName = 'claude';

export async function generateComponents(
  request: GenerateComponentsRequest,
): Promise<GenerateComponentsResponse> {
  const { agent: agentInput, ...rest } = request;

  if (agentInput !== undefined && !isAgentName(agentInput)) {
    throw new Error(`Unknown agent: "${agentInput}"`);
  }

  return runGenerationService({
    ...rest,
    agent: agentInput ?? DEFAULT_AGENT,
  });
}
