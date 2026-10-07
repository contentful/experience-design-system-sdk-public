import { checkAgentAuth } from '../services/check-agent-auth.js';
import { runAgent } from '../services/run-agent.js';
import type { AgentInvoker, CreateLocalCliAgentInvokerOptions } from '../types/invoker.js';

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
