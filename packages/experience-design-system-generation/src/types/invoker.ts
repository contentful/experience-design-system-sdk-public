import type { AgentName } from '../agent-names.js';
import type { AgentAuthStatus, AgentDebugEvent, AgentRunResult } from './agent.js';

export interface InvokeAgentOptions {
  agent: AgentName;
  model?: string;
  bedrock?: boolean;
  prompt: string;
  timeoutMs: number;
  onOutput?: (chunk: string) => void;
}

export interface AgentInvoker {
  invoke(options: InvokeAgentOptions): Promise<AgentRunResult>;
  checkAuth(agent: AgentName): Promise<AgentAuthStatus>;
}

export interface LocalCliAgentInvokerOptions {
  onDebugEvent?: AgentDebugEvent;
}
