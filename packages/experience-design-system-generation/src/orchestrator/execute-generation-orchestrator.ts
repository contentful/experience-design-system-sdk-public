import type { GenerationEndpointRequest, GenerationEndpointResponse } from '../types/contract.js';
import type { AgentInvoker } from '../services/agent/local-cli-agent-invoker.js';
import { buildPrompt } from '../services/prompts/build-prompt.js';

export interface GenerationOrchestratorRequest extends GenerationEndpointRequest {
  readonly invoker: AgentInvoker;
}

export async function executeGenerationOrchestrator(
  request: GenerationOrchestratorRequest,
): Promise<GenerationEndpointResponse> {
  const prompt = await buildPrompt(request.promptOptions);
  return request.invoker.invoke({
    agent: request.agent,
    model: request.model,
    bedrock: request.bedrock,
    prompt,
    timeoutMs: request.timeoutMs,
    onOutput: request.onOutput,
  });
}
