import type { AgentName } from './agent-name.js';
import type { AgentAuthStatus, AgentDebugEvent, AgentRunResult } from './agent-run.js';

export interface InvokeAgentOptions {
  agent: AgentName;
  model?: string;
  bedrock?: boolean;
  prompt: string;
  timeoutMs: number;
  onOutput?: (chunk: string) => void;
}

/**
 * Abstracts "invoke an agent and get a result back" from the local-subprocess
 * mechanism `runAgent` uses today. A remote implementation (e.g. against an
 * internal agents service) implements the same contract without importing
 * this package's subprocess transport.
 */
export interface AgentInvoker {
  invoke(options: InvokeAgentOptions): Promise<AgentRunResult>;
  checkAuth(agent: AgentName): Promise<AgentAuthStatus>;
}

export interface CreateLocalCliAgentInvokerOptions {
  /** Wire in a debug-event sink (e.g. the CLI's own debug logger). No-op by default. */
  onDebugEvent?: AgentDebugEvent;
}
