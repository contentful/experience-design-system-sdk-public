import type {
  GenerationEndpoint,
  GenerationEndpointOptions,
  GenerationEndpointRequest,
  GenerationEndpointResponse,
} from '../types/contract.js';
import { validateGenerationRequest } from './helpers/validate-generation-request.js';
import { executeGenerationOrchestrator } from '../orchestrator/execute-generation-orchestrator.js';
import { createLocalCliAgentInvoker } from '../services/agent/local-cli-agent-invoker.js';

export type { GenerationEndpoint, GenerationEndpointOptions, GenerationEndpointRequest, GenerationEndpointResponse };

export function createGenerationEndpoint(options: GenerationEndpointOptions = {}): GenerationEndpoint {
  const invoker = createLocalCliAgentInvoker({
    onDebugEvent: options.onDebugEvent,
  });
  return {
    async run(request) {
      validateGenerationRequest(request);
      return executeGenerationOrchestrator({ ...request, invoker });
    },
    checkAuth(agent) {
      return invoker.checkAuth(agent);
    },
  };
}
