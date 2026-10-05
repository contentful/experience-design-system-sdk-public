import type { AgentName } from '../../agent-names.js';
import type { AgentAuthStatus, AgentDebugEvent, AgentRunResult } from '../../types/agent.js';
import { runAgent } from './run-agent.js';
import { checkAgentAuth } from './helpers/check-agent-auth.js';

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

export function createLocalCliAgentInvoker(options: LocalCliAgentInvokerOptions = {}): AgentInvoker {
  const { onDebugEvent } = options;
  return {
    invoke(invokeOptions) {
      return runAgent({ ...invokeOptions, onDebugEvent });
    },
    checkAuth(agent) {
      return checkAgentAuth(agent);
    },
  };
}
