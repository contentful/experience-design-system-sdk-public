import type { AgentName } from './agent.js';

export interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type AgentDebugEvent = (name: string, payload?: Record<string, unknown>) => void;

export type AgentAuthStatus = 'ok' | 'unauthenticated' | 'not-found';

/** Transport-neutral options for one agent invocation attempt. */
export interface AgentInvocationOptions {
  agent: AgentName;
  model?: string;
  bedrock?: boolean;
  timeoutMs: number;
  onOutput?: (chunk: string) => void;
  promptViaStdin?: boolean;
}
