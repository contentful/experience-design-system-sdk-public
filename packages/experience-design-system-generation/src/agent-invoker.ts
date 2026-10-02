import type { AgentDebugEvent } from './generate/model/invocation.js';
import type { AgentInvoker } from './generate/services/ports/agent-invoker.js';
import { checkAgentAuth, runAgent } from './agent-runner.js';

export type { AgentInvoker, InvokeAgentOptions } from './generate/services/ports/agent-invoker.js';

/**
 * Abstracts "invoke an agent and get a result back" from the local-subprocess
 * mechanism `runAgent` uses today. A remote implementation (e.g. against an
 * internal agents service) implements the same contract without importing
 * this package's subprocess transport.
 */
export interface CreateLocalCliAgentInvokerOptions {
  /** Wire in a debug-event sink (e.g. the CLI's own debug logger). No-op by default. */
  onDebugEvent?: AgentDebugEvent;
}

/** Default `AgentInvoker`: spawns the agent CLI binary as a local subprocess. */
export function createLocalCliAgentInvoker(options: CreateLocalCliAgentInvokerOptions = {}): AgentInvoker {
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
