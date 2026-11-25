import type { AgentName } from './agent-name.js';

export interface AgentConversation {
  agent: AgentName;
  id: string;
}

export interface AgentRuntimeMeasurements {
  transport: 'local-cli';
  agent: AgentName;
  model?: string;
  invocationElapsedMs: number;
  launchAfterMs?: number;
  startupMs?: number;
  firstOutputMs?: number;
  firstStdoutMs?: number;
  firstEventMs?: number;
  processElapsedMs?: number;
}

export interface AgentNativeUsage {
  source: 'codex.turn.completed.usage' | 'claude.result.usage' | 'opencode.step_finish.part.tokens';
  scope: 'turn' | 'invocation' | 'step';
  counters: Record<string, number>;
}

export interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  conversation?: AgentConversation;
  measurements?: AgentRuntimeMeasurements;
  nativeUsage?: AgentNativeUsage;
}

export type AgentDebugEvent = (name: string, payload?: Record<string, unknown>) => void;

export type AgentAuthStatus = 'ok' | 'unauthenticated' | 'not-found';
