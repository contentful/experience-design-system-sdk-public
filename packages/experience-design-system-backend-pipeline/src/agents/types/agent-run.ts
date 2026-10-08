export interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type AgentDebugEvent = (name: string, payload?: Record<string, unknown>) => void;

export type AgentAuthStatus = 'ok' | 'unauthenticated' | 'not-found';
