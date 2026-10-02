import type { AgentDebugEvent } from '../../model/invocation.js';
import type { AgentInvoker } from '../../services/ports/agent-invoker.js';
import { checkAgentAuth } from '../../services/agent-auth-service.js';
import { runAgent } from './local-agent-process.js';

export interface CreateLocalCliAgentInvokerOptions {
  /** Wire in a debug-event sink (e.g. the CLI's own debug logger). No-op by default. */
  onDebugEvent?: AgentDebugEvent;
}

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
