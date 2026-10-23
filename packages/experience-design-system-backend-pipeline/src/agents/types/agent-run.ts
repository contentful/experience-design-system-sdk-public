import type { AgentName } from './agent-name.js';

export interface AgentConversation {
  agent: AgentName;
  id: string;
}

export interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  conversation?: AgentConversation;
}

export type AgentDebugEvent = (name: string, payload?: Record<string, unknown>) => void;

export type AgentAuthStatus = 'ok' | 'unauthenticated' | 'not-found';
