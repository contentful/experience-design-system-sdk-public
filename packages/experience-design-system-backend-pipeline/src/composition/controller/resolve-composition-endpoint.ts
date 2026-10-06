import { isAgentName } from '@contentful/experience-design-system-generation';
import { executeCompositionOrchestrator } from '../orchestrator/execute-composition-orchestrator.js';
import type {
  ResolveCompositionEndpointRequest,
  ResolveCompositionEndpointResponse,
} from '../types/contract.js';

export type { ResolveCompositionEndpointRequest, ResolveCompositionEndpointResponse };

export async function resolveComposition(
  request: ResolveCompositionEndpointRequest,
): Promise<ResolveCompositionEndpointResponse> {
  const { agent: agentInput, forceAgent, ...rest } = request;

  if (agentInput !== undefined && !isAgentName(agentInput)) {
    throw new Error(`Unknown agent: "${agentInput}"`);
  }

  return executeCompositionOrchestrator({
    ...rest,
    agent: agentInput ?? 'claude',
    forceAgent: forceAgent ?? false,
  });
}
