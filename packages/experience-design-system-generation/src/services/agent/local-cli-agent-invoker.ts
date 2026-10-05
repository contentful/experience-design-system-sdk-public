import type { AgentInvoker, InvokeAgentOptions, LocalCliAgentInvokerOptions } from '../../types/invoker.js';
import { runAgent } from './run-agent.js';
import { checkAgentAuth } from './helpers/check-agent-auth.js';

export type { AgentInvoker, InvokeAgentOptions, LocalCliAgentInvokerOptions };

export function createLocalCliAgentInvoker(options: LocalCliAgentInvokerOptions = {}): AgentInvoker {
  const { onDebugEvent } = options;
  return {
    invoke(invokeOptions: InvokeAgentOptions) {
      return runAgent({ ...invokeOptions, onDebugEvent });
    },
    checkAuth(agent) {
      return checkAgentAuth(agent);
    },
  };
}
