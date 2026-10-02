import type { AgentName } from '../../model/agent.js';
import type { AgentAuthStatus, AgentInvocationOptions, AgentRunResult } from '../../model/invocation.js';

export interface InvokeAgentOptions extends AgentInvocationOptions {
  prompt: string;
}

export interface AgentInvoker {
  invoke(options: InvokeAgentOptions): Promise<AgentRunResult>;
  checkAuth(agent: AgentName): Promise<AgentAuthStatus>;
}
