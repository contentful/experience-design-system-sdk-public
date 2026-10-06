import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { isAgentName } from '@contentful/experience-design-system-generation';
import {
  executeCompositionOrchestrator,
  type CompositionOrchestratorResult,
} from '../orchestrator/execute-composition-orchestrator.js';

export interface ResolveCompositionEndpointRequest {
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  agent?: string;
  forceAgent?: boolean;
  promptOverride?: string;
  onProgress?: (phase: string) => void;
  onCacheLookup?: (cacheKey: string) => string | null;
  onCacheStore?: (cacheKey: string, stdout: string) => void;
  onWarning?: (message: string) => void;
}

export type ResolveCompositionEndpointResponse = CompositionOrchestratorResult;

export async function resolveComposition(
  request: ResolveCompositionEndpointRequest,
): Promise<ResolveCompositionEndpointResponse> {
  const { agent: agentInput, forceAgent, ...rest } = request;

  if (agentInput !== undefined && !isAgentName(agentInput)) {
    throw new Error(`Unknown agent: "${agentInput}"`);
  }

  const agent = agentInput ?? 'claude';

  return executeCompositionOrchestrator({
    ...rest,
    agent,
    forceAgent: forceAgent ?? false,
  });
}
