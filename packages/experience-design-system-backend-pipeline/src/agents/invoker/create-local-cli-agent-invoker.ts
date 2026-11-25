import { checkAgentAuth } from '../services/check-agent-auth.js';
import { runAgent } from '../services/run-agent.js';
import { createCodexAppServerRuntime } from '../services/codex-app-server/runtime.js';
import type { AgentInvoker, CreateLocalCliAgentInvokerOptions, PersistentAgentLifetime } from '../types/invoker.js';

/** Default `AgentInvoker`: spawns the agent CLI binary as a local subprocess. */
export function createLocalCliAgentInvoker(
  options: CreateLocalCliAgentInvokerOptions = {},
): AgentInvoker & Partial<PersistentAgentLifetime> {
  const { onDebugEvent } = options;
  const persistent = options.codexAppServer
    ? createCodexAppServerRuntime(options.codexAppServer, onDebugEvent)
    : undefined;
  return {
    invoke(invokeOptions) {
      if (persistent && invokeOptions.agent === 'codex' && !(invokeOptions.bedrock ?? process.env.EDS_BEDROCK === '1'))
        return persistent.invoke(invokeOptions);
      return runAgent({ ...invokeOptions, preserveConversation: true, onDebugEvent });
    },
    checkAuth(agent) {
      return checkAgentAuth(agent);
    },
    ...(persistent
      ? {
          close: () => persistent.close(),
          admit: persistent.admit,
          createHandoff: persistent.createHandoff,
        }
      : {}),
  };
}
