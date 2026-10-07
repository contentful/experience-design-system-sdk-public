import { isAgentName } from '@contentful/experience-design-system-generation';
import type { AgentName } from '@contentful/experience-design-system-generation';
import { runCdfGenerationService } from '../services/run-cdf-generation-service.js';
import type { GenerateCdfComponentsRequest, GenerateCdfComponentsResponse } from '../types/contract.js';

export type { GenerateCdfComponentsRequest, GenerateCdfComponentsResponse };

const DEFAULT_AGENT: AgentName = 'claude';

export async function generateCdfComponents(
  request: GenerateCdfComponentsRequest,
): Promise<GenerateCdfComponentsResponse> {
  const { agent: agentInput, components, ...rest } = request;

  if (components.length === 0) {
    return { components: [], warnings: [], failures: [] };
  }

  if (agentInput !== undefined && !isAgentName(agentInput)) {
    throw new Error(`Unknown agent: "${agentInput}"`);
  }

  return runCdfGenerationService({
    ...rest,
    components,
    agent: agentInput ?? DEFAULT_AGENT,
  });
}
