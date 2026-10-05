import type { AgentName } from '../agent-names.js';
import type { AgentAuthStatus, AgentDebugEvent } from './agent.js';
import type { PromptOptions } from './prompt.js';

export interface GenerationEndpointRequest {
  readonly agent: AgentName;
  readonly model?: string;
  readonly bedrock?: boolean;
  readonly promptOptions: PromptOptions;
  readonly timeoutMs: number;
  readonly onOutput?: (chunk: string) => void;
}

export interface GenerationEndpointResponse {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface GenerationEndpointOptions {
  onDebugEvent?: AgentDebugEvent;
}

export interface GenerationEndpoint {
  run(request: GenerationEndpointRequest): Promise<GenerationEndpointResponse>;
  checkAuth(agent: AgentName): Promise<AgentAuthStatus>;
}
