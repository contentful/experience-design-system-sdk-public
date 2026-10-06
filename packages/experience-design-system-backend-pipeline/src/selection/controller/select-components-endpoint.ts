import { executeSelectionOrchestrator } from '../orchestrator/execute-selection-orchestrator.js';
import type {
  SelectComponentsEndpointRequest,
  SelectComponentsEndpointResponse,
} from '../types/contract.js';

export type { SelectComponentsEndpointRequest, SelectComponentsEndpointResponse };

export async function selectComponents(
  request: SelectComponentsEndpointRequest,
): Promise<SelectComponentsEndpointResponse> {
  const { agent: agentInput, ...rest } = request;

  if (!agentInput) {
    throw new Error('agent is required for component selection');
  }

  return executeSelectionOrchestrator({ ...rest, agent: agentInput });
}
