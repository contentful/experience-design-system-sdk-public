import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import {
  executeSelectionOrchestrator,
  type SelectionOrchestratorResult,
} from '../orchestrator/execute-selection-orchestrator.js';

export interface SelectComponentsEndpointRequest {
  components: RawComponentDefinition[];
  agent?: string;
  model?: string;
  promptText?: string;
  promptPath?: string;
  onCacheLookup?: (
    componentHash: string,
    promptHash: string,
  ) => { decision: 'accepted' | 'rejected'; reason: string | null } | null;
  onCacheStore?: (
    componentHash: string,
    promptHash: string,
    decision: 'accepted' | 'rejected',
    reason: string | null,
  ) => void;
  onWarning?: (message: string) => void;
}

export type SelectComponentsEndpointResponse = SelectionOrchestratorResult;

export async function selectComponents(
  request: SelectComponentsEndpointRequest,
): Promise<SelectComponentsEndpointResponse> {
  const { agent: agentInput, ...rest } = request;

  if (!agentInput) {
    throw new Error('agent is required for component selection');
  }

  return executeSelectionOrchestrator({
    ...rest,
    agent: agentInput,
  });
}
