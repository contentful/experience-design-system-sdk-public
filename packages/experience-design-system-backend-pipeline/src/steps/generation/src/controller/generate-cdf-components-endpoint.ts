import { isAgentName } from '../../../../agents/index.js';
import { DEFAULT_AGENT } from '../../../shared/constants/index.js';
import { runCdfGenerationService } from '../services/run-cdf-generation-service.js';
import type { GenerateCdfComponentsRequest, GenerateCdfComponentsResponse } from '../types/contract.js';
import { throwIfAborted } from '../../../../helpers/abort.js';

export type { GenerateCdfComponentsRequest, GenerateCdfComponentsResponse };

export async function generateCdfComponents(
  request: GenerateCdfComponentsRequest,
): Promise<GenerateCdfComponentsResponse> {
  throwIfAborted(request.signal);
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
