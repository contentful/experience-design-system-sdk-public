import { isAgentName } from '../../agent-names.js';
import type { GenerationEndpointRequest } from '../../types/contract.js';

export function validateGenerationRequest(request: GenerationEndpointRequest): void {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('createGenerationEndpoint requires a request object');
  }

  if (!isAgentName(request.agent)) {
    throw new TypeError(
      `createGenerationEndpoint requires agent to be a valid agent name, got: ${String(request.agent)}`,
    );
  }

  if (typeof request.timeoutMs !== 'number' || request.timeoutMs <= 0) {
    throw new TypeError('createGenerationEndpoint requires timeoutMs to be a positive number');
  }

  if (request.promptOptions === null || typeof request.promptOptions !== 'object') {
    throw new TypeError('createGenerationEndpoint requires promptOptions to be an object');
  }

  if (request.onOutput !== undefined && typeof request.onOutput !== 'function') {
    throw new TypeError('createGenerationEndpoint requires onOutput to be a function when provided');
  }
}
