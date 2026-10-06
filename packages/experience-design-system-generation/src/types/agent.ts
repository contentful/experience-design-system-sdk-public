import type { AgentName } from '../agent-names.js';

export type { AgentName };

export interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type AgentAuthStatus = 'ok' | 'unauthenticated' | 'not-found';

export type AgentDebugEvent = (name: string, payload?: Record<string, unknown>) => void;
